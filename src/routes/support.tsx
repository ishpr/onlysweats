import { createFileRoute, Link } from "@tanstack/react-router";
import { Prose, Section, SiteShell, SupportEmail } from "@/components/site/site-shell";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/support")({
  head: () => ({ meta: [{ title: "Support — SamePace" }] }),
  component: Support,
});

function Support() {
  return (
    <SiteShell>
      <Prose title="Support" lede="A person reads every message. We answer within one business day.">
        <Section title="Get in touch">
          <p>Email <SupportEmail /> from the address on your account and tell us what happened. For a problem with a particular session, include its day and time.</p>
          <p><strong>If you’re in danger, call 911 first.</strong> {SITE.name} doesn’t contact emergency services.</p>
        </Section>

        <Section title="Report someone">
          <p>If someone made you feel unsafe, asked for payment, or treated a session as something other than a workout, write to us with their first name and the session. We review every report, and confirmed reports lead to removal.</p>
        </Section>

        <Section title="Check-in isn’t working">
          <ul>
            <li>You need to be within 150 metres of the meeting pin, between 20 minutes before the start and 25 minutes after.</li>
            <li>No signal, or GPS is off by a block? Ask the person who posted the session to reveal their four-digit code and type it in. It checks you both in.</li>
            <li>Location access is only used on the check-in screen. You can turn it on in your phone’s Settings.</li>
          </ul>
        </Section>

        <Section title="Cancelling, fees and strikes">
          <p>Cancelling 12 hours or more ahead is free. The full rules, and how to dispute a fee, are in our <Link to="/terms" className="rounded font-medium text-fg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand">Terms</Link>.</p>
        </Section>

        <Section title="Delete your account">
          <p>Email us from the address on your account and we’ll delete it and everything tied to it. What we keep and why is in our <Link to="/privacy" className="rounded font-medium text-fg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stand">Privacy policy</Link>.</p>
        </Section>
      </Prose>
    </SiteShell>
  );
}
