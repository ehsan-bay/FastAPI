import { Bone, Dumbbell, FlaskConical, HeartPulse, Mic, Moon, Pill, QrCode, ScanFace, Settings, Shield, Wallet } from "lucide-react";
import { Card, ListLink, Page, SectionTitle } from "../components/ui";
import { useAuth } from "../lib/auth";
import { toman } from "../lib/format";

export default function More() {
  const { user } = useAuth();
  return (
    <Page title="همه امکانات">
      <SectionTitle>پایش روزانه</SectionTitle>
      <Card className="list-card">
        <ListLink to="/voice" icon={Mic} tone="teal" title="ثبت صوتی" sub="فشار، قند، غذا و حال را بگویید" />
        <ListLink to="/vitals" icon={HeartPulse} tone="red" title="علائم حیاتی" sub="فشار، قند، وزن، ضربان" />
        <ListLink to="/meds" icon={Pill} tone="rose" title="داروها" sub="یادآور و خواندن با صدا" />
        <ListLink to="/sleep" icon={Moon} tone="indigo" title="پایش خواب" sub="خروپف و سرفه، روی گوشی" />
        <ListLink to="/coach" icon={Dumbbell} tone="blue" title="مربی ورزش" sub="شمارش حرکات با دوربین" />
      </Card>
      <SectionTitle>غربالگری با هوش مصنوعی</SectionTitle>
      <Card className="list-card">
        <ListLink to="/xray" icon={Bone} tone="slate" title="عکس قفسه سینه" sub="۱۸ یافته رادیولوژی" />
        <ListLink to="/skin" icon={ScanFace} tone="amber" title="بررسی پوست" sub="غربالگری خال و ضایعه" />
        <ListLink to="/lab" icon={FlaskConical} tone="violet" title="برگه آزمایش" sub="خواندن و توضیح نتایج" />
      </Card>
      <SectionTitle>پرداخت و حساب</SectionTitle>
      <Card className="list-card">
        <ListLink to="/scan" icon={QrCode} tone="indigo" title="پرداخت ویزیت" sub="اسکن QR مطب" />
        <ListLink to="/wallet" icon={Wallet} tone="green" title="کیف پول و گزارش" sub={toman(user?.wallet_balance)} />
        {user?.is_admin && <ListLink to="/admin" icon={Shield} tone="slate" title="پنل مدیریت" sub="پزشکان، پرداخت‌ها، گزارش" />}
        <ListLink to="/settings" icon={Settings} tone="slate" title="تنظیمات" sub="حالت سالمند، صدا، حساب" />
      </Card>
    </Page>
  );
}
