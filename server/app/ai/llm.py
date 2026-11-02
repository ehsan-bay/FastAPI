"""Optional small LLM (e.g. Qwen2.5-0.5B/1.5B-Instruct GGUF) via llama-cpp-python.

If no model file or llama-cpp is installed, the assistant falls back to rule-based replies,
so the app still works on small free hosting plans.
"""
import threading

from ..config import settings
from . import mood

SYSTEM_PROMPT = (
    "تو «سلامت‌یار» هستی، یک دستیار مهربان سلامت عمومی و سلامت روان که به فارسی ساده و کوتاه جواب می‌دهد. "
    "تشخیص پزشکی نده و دارو تجویز نکن؛ در موارد جدی کاربر را به پزشک ارجاع بده. "
    "اگر کاربر از آسیب به خود حرف زد، با همدلی شماره‌های ۱۲۳ و ۱۴۸۰ و اورژانس ۱۱۵ را بده."
)


class LLM:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._error = ""

    def available(self) -> bool:
        if not settings.llm_model_path:
            return False
        try:
            import llama_cpp  # noqa: F401
        except ImportError:
            return False
        return True

    def _load(self):
        if self._model is None:
            from llama_cpp import Llama

            self._model = Llama(
                model_path=settings.llm_model_path,
                n_ctx=2048,
                n_threads=settings.llm_threads,
                verbose=False,
            )
        return self._model

    def chat(self, messages: list[dict], max_tokens: int = 300) -> str | None:
        """Return the model reply, or None if the LLM is not available."""
        if not self.available():
            return None
        try:
            with self._lock:
                model = self._load()
                out = model.create_chat_completion(
                    messages=[{"role": "system", "content": SYSTEM_PROMPT}, *messages[-8:]],
                    max_tokens=max_tokens,
                    temperature=0.6,
                )
            return out["choices"][0]["message"]["content"].strip()
        except Exception as exc:  # keep the app usable if the model fails
            self._error = str(exc)
            return None


llm = LLM()

FAQ = [
    (("سردرد", "headache"), "برای سردرد خفیف: آب کافی بنوش، استراحت کن و از نور صفحه دور باش. سردرد ناگهانی و شدید، همراه با تب، سفتی گردن یا اختلال دید نیاز به مراجعه فوری دارد."),
    (("خواب", "بی‌خوابی", "بیخوابی", "sleep", "insomnia"), "برای خواب بهتر: ساعت ثابت خواب و بیداری، اتاق تاریک و خنک، نخوردن کافئین بعد از ساعت ۱۴ و کنار گذاشتن گوشی یک ساعت قبل از خواب."),
    (("وزن", "لاغر", "رژیم", "diet", "weight"), "کاهش وزن سالم حدود نیم کیلو در هفته است: حدود ۵۰۰ کالری کمتر از نیاز روزانه، پروتئین کافی، سبزیجات و ۱۵۰ دقیقه فعالیت در هفته."),
    (("فشار", "blood pressure"), "فشار خون طبیعی زیر ۱۲۰/۸۰ است. نمک کمتر، ورزش منظم، کنترل وزن و پرهیز از سیگار کمک می‌کند. فشار بالای ۱۸۰/۱۲۰ اورژانسی است."),
    (("قند", "دیابت", "diabetes", "glucose"), "قند ناشتای ۱۰۰ تا ۱۲۵ پیش‌دیابت و ۱۲۶ به بالا (در دو آزمایش) دیابت محسوب می‌شود. کم کردن قند ساده، ورزش و کاهش وزن بسیار مؤثر است."),
    (("ورزش", "exercise", "workout"), "توصیه سازمان جهانی بهداشت: هفته‌ای ۱۵۰ تا ۳۰۰ دقیقه فعالیت متوسط مثل پیاده‌روی تند، به‌علاوه دو جلسه تمرین قدرتی."),
    (("آب", "water"), "بیشتر بزرگسالان روزانه حدود ۸ لیوان آب نیاز دارند؛ در هوای گرم و هنگام ورزش بیشتر."),
]


def fallback_reply(text: str) -> str:
    analysis = mood.analyze(text)
    if analysis["risk"]:
        return mood.CRISIS_MESSAGE
    low = text.lower()
    for keys, answer in FAQ:
        if any(k in low for k in keys):
            return answer + "\n\n(این پاسخ عمومی است و جایگزین مشاوره پزشکی نیست.)"
    if analysis["emotions"] or abs(analysis["sentiment"]) > 0.2:
        return mood.rule_reply(analysis)
    return ("من دستیار سلامت هستم و درباره خواب، تغذیه، ورزش، فشار خون، قند و حال روحی می‌توانم راهنمایی عمومی بدهم. "
            "سؤالت را کمی دقیق‌تر بپرس.")
