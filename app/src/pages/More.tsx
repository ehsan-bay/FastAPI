import { Page, Tile } from "../components/ui";

export default function More() {
  return (
    <Page title="بیشتر">
      <div className="grid2">
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
