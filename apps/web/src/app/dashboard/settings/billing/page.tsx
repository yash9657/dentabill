import { redirect } from 'next/navigation';

export default function SettingsBillingPage(): never {
  redirect('/dashboard/settings/usage');
}
