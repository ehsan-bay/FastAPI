import { Page, Tile } from "../components/ui";
import { useAuth } from "../lib/auth";
import { toman } from "../lib/format";

export default function More() {
  const { user } = useAuth();
  return (
    <Page title="بیشتر">
      <div className="grid2">
        <Tile to="/scan" icon="📷" title="پرداخت ویزیت" sub="اسکن QR مطب" />
        <Tile to="/wallet" icon="👛" title="کیف پول و گزارش" sub={toman(user?.wallet_balance)} />
        {user?.is_admin && <Tile to="/admin" icon="🛠️" title="پنل مدیریت" sub="پزشکان، پرداخت‌ها، گزارش" />}
        <Tile to="/skin" icon="🩺" title="بررسی پوست" sub="غربالگری خال" />
        <Tile to="/lab" icon="🧪" title="برگه آزمایش" sub="OCR و تفسیر" />
        <Tile to="/sleep" icon="😴" title="پایش خواب" sub="خروپف و سرفه" />
        <Tile to="/vitals" icon="❤️" title="علائم حیاتی" sub="فشار، قند، وزن" />
        <Tile to="/meds" icon="💊" title="داروها" sub="یادآور مصرف" />
        <Tile to="/settings" icon="⚙️" title="تنظیمات" sub="حساب و سرور" />
      </div>
    </Page>
  );
}
