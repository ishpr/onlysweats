import { createFileRoute } from "@tanstack/react-router";
import { Prose, Section, SiteShell, SupportEmail } from "@/components/site/site-shell";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms — SamePace" }] }),
  component: Terms,
});

function Terms() {
  return (
    <SiteShell>
      <Prose
        title="Terms of use"
        lede={`The agreement between you and ${SITE.name}. Last updated ${SITE.policiesUpdated}.`}
      >
        <Section title="What SamePace is">
          <p>{SITE.name} helps adults find one to three other people, at a similar level, to do a workout they were already planning — and records whether everyone showed up. That is all it does.</p>
          <p><strong>It is not a trainer, a coach, a club or an event organiser.</strong> We don’t supervise sessions, check anyone’s fitness, inspect venues or routes, or provide medical advice. Members are not our employees or agents.</p>
        </Section>

        <Section title="Who can use it">
          <p>You must be 18 or older, use your real first name, and keep one account. You’re responsible for what happens under your account.</p>
        </Section>

        <Section title="Your safety is your responsibility">
          <ul>
            <li>Physical activity carries risk of injury. You take part at your own risk, and you alone decide whether an activity, a level, a place or a person is right for you. Talk to a doctor if you’re unsure.</li>
            <li>Sessions happen in public places. Meet there, tell someone where you’re going, and leave if anything feels wrong.</li>
            <li>In an emergency call 911. {SITE.name} does not contact emergency services for you.</li>
          </ul>
        </Section>

        <Section title="How members behave">
          <ul>
            <li><strong>State your level honestly.</strong> A level is about the workout — a pace, a speed, a distance.</li>
            <li><strong>Nobody charges.</strong> No money moves between members. Asking for payment for a session is grounds for removal.</li>
            <li><strong>This is not a place to meet romantic partners.</strong> Treating a session that way can be reported by the other person, and confirmed reports lead to removal.</li>
            <li>No harassment, threats, discrimination, or contacting someone who has asked you to stop. No commercial solicitation.</li>
            <li>Women-only sessions are for women. Misrepresenting yourself to join one leads to removal.</li>
          </ul>
        </Section>

        <Section title="Showing up">
          <p>The point of {SITE.name} is that people come. These rules apply equally to whoever posted a session and whoever joined it:</p>
          <ul>
            <li><strong>Cancel 12 hours or more before the start:</strong> no cost.</li>
            <li><strong>Cancel inside 12 hours:</strong> a $5 fee, waived if someone else takes the seat.</li>
            <li><strong>No-show:</strong> a $10 fee and a strike. The person who did show up receives $5 of membership credit. A fee is held for 24 hours after the session so it can be disputed.</li>
            <li><strong>Two strikes in 60 days:</strong> posting and joining public sessions is paused for 14 days. Invitations from people you know still work.</li>
          </ul>
          <p>Fees and credits are recorded on your account. We don’t charge a card today; before any charge is ever made we will ask you to add a payment method and tell you exactly what will be collected. Credit has no cash value.</p>
          <p>To dispute a fee or a strike, write to <SupportEmail /> within 24 hours of the session.</p>
        </Section>

        <Section title="Membership">
          <p>{SITE.name} is free today. We intend to offer a paid membership once an area is busy enough to be worth paying for. Your first two completed sessions will always be free, and we’ll give you notice and a clear price before you’re ever asked to pay.</p>
        </Section>

        <Section title="Your content">
          <p>You keep ownership of what you write. You give us permission to store and show it as the service requires — a session to people browsing, a message to the person you sent it to. Don’t post anything unlawful or that isn’t yours.</p>
        </Section>

        <Section title="Ending things">
          <p>You can stop using {SITE.name} and ask us to delete your account at any time. We may suspend or remove an account that breaks these terms or puts other members at risk.</p>
        </Section>

        <Section title="Warranty and liability">
          <p>The service is provided “as is”. To the fullest extent the law allows, we disclaim all warranties, and we are not liable for the acts or omissions of members, for injury, loss or damage arising from a session, or for indirect or consequential losses. Where liability cannot be excluded, it is limited to the greater of what you paid us in the past twelve months or US $50.</p>
        </Section>

        <Section title="The rest">
          <p>These terms are governed by the laws of the State of Texas, and disputes belong in the courts of Dallas County, Texas. If a part of these terms can’t be enforced, the rest still applies. If we change them in a way that matters, we’ll tell you in the app before the change takes effect.</p>
          <p>Questions: <SupportEmail /></p>
        </Section>
      </Prose>
    </SiteShell>
  );
}
