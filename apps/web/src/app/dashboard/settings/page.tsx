import { redirect } from 'next/navigation';

/**
 * /dashboard/settings — canonical landing redirect. Always sends
 * the user to the Organization sub-page, the natural first stop in
 * the Settings tour.
 */
export default function DashboardSettingsIndex(): never {
  redirect('/dashboard/settings/organization');
}
