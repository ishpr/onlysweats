import { createFileRoute } from "@tanstack/react-router";
import { Prose, Section, SiteShell, SupportEmail } from "@/components/site/site-shell";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy — SamePace" }] }),
  component: Privacy,
});

function Privacy() {
  return (
    <SiteShell>
      <Prose
        title="Privacy"
        lede={`What ${SITE.name} collects, why, and what it never does. Last updated ${SITE.policiesUpdated}.`}
      >
        <Section title="The short version">
          <ul>
            <li>We collect what it takes to get two to four people to the same place at the same time — and nothing to build a profile of you.</li>
            <li>We don’t show ads, sell data, or run third-party trackers in the app.</li>
            <li>Your location is read only when you tap Check in, and the coordinates are not stored.</li>
            <li>Nobody can search for you. People see you only on a session you posted or joined.</li>
          </ul>
        </Section>

        <Section title="What we collect">
          <ul>
            <li><strong>Your account.</strong> You sign in with Apple or Google, which gives us your name and email address. With Apple’s Hide My Email we only receive the relay address.</li>
            <li><strong>Your profile.</strong> A first name, your neighbourhood, and the level you set for each activity (a pace, a speed, an experience level). You may tell us your gender; it is used only to open women-only sessions to women, is never shown to anyone and is never used for ranking.</li>
            <li><strong>Sessions.</strong> What you post and join, when you cancelled, whether you checked in and by which method, and the five yes/no answers people give each other afterwards.</li>
            <li><strong>Messages.</strong> Chat is tied to a single booking and closes a day after the session. We keep the messages so a report can be reviewed; a person at {SITE.name} reads a thread only when a report points at it.</li>
            <li><strong>Reliability.</strong> Strikes, fees and credits recorded on your account under the rules in our Terms.</li>
            <li><strong>Location, once.</strong> When you tap Check in, your phone sends its position so our server can measure the distance to the meeting pin. We record that you checked in and when — not where you were. The app never reads location in the background.</li>
          </ul>
          <p>We don’t collect your contacts, photos, health data, age (beyond confirming you’re 18 or over), height, weight or relationship status.</p>
        </Section>

        <Section title="Who sees what">
          <ul>
            <li><strong>Other members</strong> see your first name, initials, levels and track record (sessions completed, on-time rate, would-join-again rate, member since) — and only on a session you posted or joined. There is no member directory and no people search.</li>
            <li><strong>The exact meeting spot and the check-in code</strong> go only to the people confirmed on that session.</li>
            <li><strong>Companies that run our infrastructure</strong> process data on our behalf: Vercel (hosting), Neon (database), and Apple and Google (sign-in). They may not use it for their own purposes.</li>
            <li>We disclose information if the law requires it, or to protect someone’s safety.</li>
          </ul>
        </Section>

        <Section title="Keeping and deleting">
          <p>We keep your account data while your account is open. You can delete your account yourself, at any time, in the app: <strong>You → Delete account</strong>. It takes effect immediately. If you can’t get into the app, email <SupportEmail /> from the address on your account and we’ll do it for you.</p>
          <p>Deleting removes your sign-in, your name, neighborhood, level and the rest of your profile, your messages, your block list, and any sessions or seats you had coming up. What stays is what belongs to other people’s history too: that a session happened and who showed up, any fee tied to it, ratings you gave, and any safety report — along with the thread it points at. Those are shown against “Deleted member”, never your name. If an account was removed for breaking the rules, we keep a scrambled fingerprint of its email address, and nothing else, so it can’t simply be opened again.</p>
          <p><strong>Reports and blocks.</strong> When you report someone we store the report, who it is about, and the session it concerns. The person you report or block isn’t told.</p>
        </Section>

        <Section title="Your choices">
          <ul>
            <li>You can decline location access and check in with the session code instead.</li>
            <li>You can leave your gender unset; you then won’t see women-only sessions.</li>
            <li>You can ask for a copy of your data, a correction, or deletion. Depending on where you live you may have further rights; write to us and we’ll honour them.</li>
          </ul>
        </Section>

        <Section title="Age">
          <p>{SITE.name} is for adults. You must be 18 or older to use it, and we don’t knowingly collect data from anyone younger.</p>
        </Section>

        <Section title="Changes and contact">
          <p>If we change this policy in a way that matters, we’ll tell you in the app before it takes effect. Questions: <SupportEmail /></p>
        </Section>
      </Prose>
    </SiteShell>
  );
}
