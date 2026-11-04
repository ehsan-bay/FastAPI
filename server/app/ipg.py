"""Bank gateway (IPG) integration, "simple" method of the IPG_Service document (v1.7).

Flow
1. start_payment(): a pending Payment is created; the browser posts a form to the gateway page
   (MID, resNum, Amount in rial, redirectURL, language, …).
2. The gateway posts the result back to /api/ipg/callback (State, ResNum, RefNum, CustomerRefNum, MID, …).
3. handle_callback(): if State == "OK", the transaction is confirmed with the REST services
   merchantLogin + verifyMerchantTrans and the amount is checked; on a mismatch it is reversed
   (reverseTransaction). Only then the doctor's balance is credited.
"""
import json
import logging
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass

from sqlalchemy import update
from sqlmodel import Session, select

from .db import Doctor, Payment, User, now
from .wallet import get_int, get_setting, new_ref

log = logging.getLogger("salamat.ipg")

SUCCESS = {"ersucceed"}

ERROR_FA = {
    "erAAS_InvalidUseridOrPass": "کد کاربری یا رمز درگاه صحیح نیست",
    "erAAS_InvalidSession": "شناسه ورود به درگاه معتبر نیست",
    "erAAS_SessionIsExpired": "شناسه ورود به درگاه منقضی شده است",
    "erScm_OrgTransNotApproved": "تراکنش اصلی موفق نبوده است",
    "erScm_OrgTransVerifiedBefore": "تراکنش قبلاً تأیید شده است",
    "erScm_AmountNotEqualWithOrgTransAmount": "مبلغ با مبلغ تراکنش برابر نیست",
    "erScm_InvalidReferenceNum": "کد رفرنس معتبر نیست",
    "erScm_TimeoutFromSwitch": "پاسخی از مرکز تراکنش دریافت نشد",
    "erScm_NotConnectSwitch": "عدم برقراری ارتباط با مرکز تراکنش",
    "erScm_OrgTransReversedBefore": "تراکنش قبلاً برگشت خورده است",
}


def _norm(code: str | None) -> str:
    return (code or "").replace("_", "").lower()


def is_success(code: str | None) -> bool:
    return _norm(code) in SUCCESS


@dataclass
class IpgConfig:
    enabled: bool
    payment_url: str
    mid: str
    rest_url: str
    username: str
    password: str
    allow_unverified: bool
    multiplier: int
    language: str
    public_url: str

    @property
    def can_verify(self) -> bool:
        return bool(self.rest_url and self.username and self.password)


def config(session: Session) -> IpgConfig:
    return IpgConfig(
        enabled=get_setting(session, "ipg_enabled") == "1",
        payment_url=get_setting(session, "ipg_payment_url").strip(),
        mid=get_setting(session, "ipg_mid").strip(),
        rest_url=get_setting(session, "ipg_rest_url").strip().rstrip("/"),
        username=get_setting(session, "ipg_username").strip(),
        password=get_setting(session, "ipg_password"),
        allow_unverified=get_setting(session, "ipg_allow_unverified") == "1",
        multiplier=max(1, get_int(session, "ipg_amount_multiplier")),
        language=get_setting(session, "ipg_language").strip() or "fa",
        public_url=get_setting(session, "public_url").strip().rstrip("/"),
    )


# --- REST client --------------------------------------------------------------------------------
class GatewayError(RuntimeError):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or ERROR_FA.get(code, code))
        self.code = code


def _get(d: dict, *names):
    """Field lookup that ignores case (the document mixes SessionId / sessionId / Result / result)."""
    lower = {k.lower(): v for k, v in d.items()} if isinstance(d, dict) else {}
    for n in names:
        if n.lower() in lower:
            return lower[n.lower()]
    return None


class IpgClient:
    _session_id: str | None = None
    _lock = threading.Lock()

    def __init__(self, cfg: IpgConfig, timeout: float = 20):
        self.cfg = cfg
        self.timeout = timeout

    def _post(self, endpoint: str, param: dict) -> dict:
        url = f"{self.cfg.rest_url}/{endpoint.strip('/')}/"
        body = json.dumps({"param": param}).encode()
        req = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode() or "{}")
        except urllib.error.URLError as exc:
            raise GatewayError("connection", f"ارتباط با سرویس درگاه برقرار نشد ({exc.reason if hasattr(exc, 'reason') else exc})")
        except (ValueError, OSError) as exc:
            raise GatewayError("bad_response", f"پاسخ نامعتبر از سرویس درگاه ({exc})")
        # Some deployments wrap the result object (e.g. {"return": {...}}).
        if isinstance(data, dict) and len(data) == 1 and isinstance(next(iter(data.values())), dict) \
                and _get(data, "result") is None:
            data = next(iter(data.values()))
        return data

    def login(self) -> str:
        data = self._post("merchantLogin", {"UserName": self.cfg.username, "Password": self.cfg.password})
        code = str(_get(data, "Result") or "")
        if not is_success(code):
            raise GatewayError(code)
        sid = _get(data, "SessionId")
        if not sid:
            raise GatewayError("no_session", "شناسه ورود از درگاه دریافت نشد")
        IpgClient._session_id = str(sid)
        return IpgClient._session_id

    def _with_session(self, endpoint: str, param: dict) -> dict:
        """Calls a service with the cached SessionId; logs in again once if the session is invalid."""
        with IpgClient._lock:
            sid = IpgClient._session_id or self.login()
        data = self._post(endpoint, {"WSContext": {"SessionId": sid, "UserName": self.cfg.username,
                                                   "Password": self.cfg.password}, **param})
        code = str(_get(data, "Result") or "")
        if "session" in code.lower():
            with IpgClient._lock:
                sid = self.login()
            data = self._post(endpoint, {"WSContext": {"SessionId": sid, "UserName": self.cfg.username,
                                                       "Password": self.cfg.password}, **param})
        return data

    def verify(self, token: str, ref_num: str) -> tuple[str, int | None]:
        data = self._with_session("verifyMerchantTrans", {"Token": token, "RefNum": ref_num})
        amount = _get(data, "Amount")
        try:
            amount = int(float(amount)) if amount not in (None, "") else None
        except (TypeError, ValueError):
            amount = None
        return str(_get(data, "Result") or ""), amount

    def reverse(self, token: str, ref_num: str) -> str:
        data = self._with_session("reverseTransaction", {"Token": token, "RefNum": ref_num})
        return str(_get(data, "Result") or "")


# --- payment flow -------------------------------------------------------------------------------
def start_payment(session: Session, user: User, doctor: Doctor, amount: int, base_url: str) -> dict:
    """Creates a pending payment and returns the form the browser must post to the gateway."""
    cfg = config(session)
    payment = Payment(user_id=user.id, doctor_id=doctor.id, amount=amount, method="ipg", status="pending",
                      ref=new_ref(), updated_at=now())
    session.add(payment)
    session.commit()
    session.refresh(payment)
    site = cfg.public_url or base_url.rstrip("/")
    fields = {
        "MID": cfg.mid,
        "resNum": payment.ref,
        "goodReferenceId": "",
        "merchantData": f"doctor-{doctor.id}",
        "Amount": str(amount * cfg.multiplier),
        "redirectURL": f"{site}/api/ipg/callback",
        "language": cfg.language,
        "email": "",
        "mobileNo": "",
        "userId": str(user.id),
    }
    return {"payment_id": payment.id, "ref": payment.ref, "action": cfg.payment_url, "fields": fields}


def _credit_doctor(session: Session, payment: Payment) -> None:
    session.execute(update(Doctor).where(Doctor.id == payment.doctor_id).values(balance=Doctor.balance + payment.amount))


def handle_callback(session: Session, form: dict, client_factory=IpgClient) -> Payment | None:
    """Processes the gateway's post-back. Safe to call more than once for the same payment."""
    res_num = (form.get("ResNum") or form.get("resNum") or "").strip()
    if not res_num:
        return None
    payment = session.exec(select(Payment).where(Payment.ref == res_num, Payment.method == "ipg")).first()
    if payment is None:
        log.warning("IPG callback for unknown ResNum %s", res_num)
        return None
    if payment.status != "pending":
        return payment  # already processed (refresh / double post)

    cfg = config(session)
    state = (form.get("State") or form.get("state") or "").strip()
    ref_num = (form.get("RefNum") or form.get("refNum") or "").strip()
    token = (form.get("token") or form.get("Token") or "").strip()
    mid = (form.get("MID") or "").strip()
    payment.gateway_state = state[:50]
    payment.gateway_ref = ref_num[:60] or None
    payment.gateway_rrn = (form.get("CustomerRefNum") or "").strip()[:60] or None
    payment.gateway_token = token[:80] or None
    payment.updated_at = now()

    def finish(status: str, message: str, verified: bool | None = None) -> Payment:
        payment.status = status
        payment.gateway_message = message[:300]
        payment.verified = verified
        if status == "paid":
            _credit_doctor(session, payment)
        session.add(payment)
        session.commit()
        session.refresh(payment)
        return payment

    if state.upper() != "OK" or not ref_num:
        return finish("failed", "لغو شده توسط کاربر" if "cancel" in state.lower() else f"ناموفق ({state or 'بدون وضعیت'})")
    if mid and cfg.mid and mid != cfg.mid:
        return finish("failed", "کد پذیرنده (MID) پاسخ با تنظیمات یکسان نیست")

    expected = payment.amount * cfg.multiplier
    if not cfg.can_verify:
        if cfg.allow_unverified:
            return finish("paid", "پرداخت موفق؛ تأیید سمت سرور (Verify) تنظیم نشده است", verified=False)
        payment.gateway_message = "در انتظار تأیید: تنظیمات سرویس Verify درگاه کامل نیست"
        session.add(payment)
        session.commit()
        return payment

    client = client_factory(cfg)
    try:
        code, amount = client.verify(token, ref_num)
    except GatewayError as exc:
        # Unknown outcome: keep it pending so it can be checked again, never credit blindly.
        payment.gateway_message = f"خطا در تأیید تراکنش: {exc}"
        session.add(payment)
        session.commit()
        return payment
    if not is_success(code):
        return finish("failed", f"تأیید تراکنش ناموفق: {ERROR_FA.get(code, code)}", verified=False)
    if amount is not None and amount != expected:
        try:
            rev = client.reverse(token, ref_num)
            note = "برگشت داده شد" if is_success(rev) else f"برگشت ناموفق: {rev}"
        except GatewayError as exc:
            note = f"برگشت ناموفق: {exc}"
        return finish("failed", f"مبلغ تأییدشده ({amount}) با مبلغ پرداخت ({expected}) برابر نیست؛ {note}", verified=False)
    return finish("paid", "پرداخت موفق و تأییدشده", verified=True)


def recheck(session: Session, payment: Payment, client_factory=IpgClient) -> Payment:
    """Admin action: verify a payment that stayed pending (e.g. the verify service was unreachable)."""
    if payment.method != "ipg" or payment.status != "pending" or not payment.gateway_ref:
        return payment
    form = {"ResNum": payment.ref, "State": payment.gateway_state or "OK", "RefNum": payment.gateway_ref,
            "CustomerRefNum": payment.gateway_rrn or "", "token": payment.gateway_token or ""}
    return handle_callback(session, form, client_factory) or payment
