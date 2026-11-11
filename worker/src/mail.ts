import type { AppEnv } from './env';

/**
 * The one place that sends mail. Uses the Cloudflare Email Sending `send_email` binding;
 * to use another provider, change this function and `mailEnabled`.
 */
export function mailEnabled(env: AppEnv): boolean {
  return !!env.EMAIL && !!env.EMAIL_FROM;
}

export async function sendMail(env: AppEnv, to: string, subject: string, text: string, html: string): Promise<void> {
  if (!env.EMAIL || !env.EMAIL_FROM) throw new Error('Email sending is not configured');
  await env.EMAIL.send({ to, from: parseFrom(env.EMAIL_FROM), subject, text, html });
}

/** "Name <addr@x>" or "addr@x" */
function parseFrom(v: string): string | { email: string; name: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(v);
  return m ? { email: m[2], name: m[1].replace(/^"|"$/g, '') } : v.trim();
}
