import { supabase } from './supabaseClient';

// supabase-js's default `error.message` on a functions.invoke() failure is
// almost never useful for debugging: a network/CORS-level failure (function
// unreachable, preflight blocked) collapses to the generic
// "Failed to send a request to the Edge Function", and even when the
// function *did* run and respond with a real reason (e.g. "Telegram is not
// connected.", "TELEGRAM_BOT_TOKEN is not configured"), the SDK's top-level
// `error.message` is just "Edge Function returned a non-2xx status code" —
// the actual reason is inside `error.context`, a Response the SDK doesn't
// unwrap for you. This pulls the real reason out wherever one exists, so
// toasts/logs show the true cause instead of a dead-end generic string.
export async function describeFunctionsError(error: unknown): Promise<string> {
  const name = (error as { name?: string })?.name;
  const context = (error as { context?: unknown })?.context;
  if (name === 'FunctionsHttpError' && context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      // Body wasn't JSON (or already read) — fall through to a status-based message.
    }
    return `Telegram server error (HTTP ${context.status}).`;
  }
  if (name === 'FunctionsRelayError') {
    return (error as Error)?.message || 'Telegram relay error — try again in a moment.';
  }
  if (name === 'FunctionsFetchError') {
    // The request never reached the function at all — network down, function
    // not deployed, or (before this fix) a blocked CORS preflight.
    return 'Telegram service tak pahunch nahi paaya (network/deploy issue) — internet check karein ya thodi der baad try karein.';
  }
  return (error as Error)?.message || 'Telegram request failed for an unknown reason.';
}

async function call(action:'begin'|'poll'|'status'|'test'|'security_alert'|'send_report'|'send_weekly_report',message?:string,report?:unknown){const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Sign in to connect Telegram.');const {data,error}=await supabase.functions.invoke('telegram-connect',{body:{action,message,report}});if(error)throw new Error(await describeFunctionsError(error));return data;}
export async function openTelegramConnection(){const d=await call('begin');if(d?.deepLink)window.open(d.deepLink,'_blank','noopener,noreferrer');return d;}
export const pollTelegramConnection=()=>call('poll'); export const sendTelegramTest=()=>call('test');
export const sendTelegramSecurityAlert=(message:string)=>call('security_alert',message);
// Generic plain-text report sender (Customer Directory export, etc.) — same
// transport as the security alert but without the alert framing/prefix.
export const sendTelegramReport=(message:string)=>call('send_report',message);
// Weekly owner report — sends a designed PDF (not plain text) built server-side
// from the report object computed in utils/weeklyReport.ts.
export const sendWeeklyReportToTelegram=(report:unknown)=>call('send_weekly_report',undefined,report);
