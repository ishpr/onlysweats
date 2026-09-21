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
            <li>
              We collect what it takes to get two to four people to the same place at the same time.
              Optional Apple Health sync keeps your workout records private. Built-in coaching uses
              relevant records as described below; your private history is not shared with workout
              buddies.
            </li>
            <li>We don’t show ads, sell data, or run third-party trackers in the app.</li>
            <li>
              Your location is read only when you tap Check in, and the coordinates are not stored.
            </li>
            <li>
              Nobody can search for you. People see you only on a session you posted or joined.
            </li>
          </ul>
        </Section>

        <Section title="What we collect">
          <ul>
            <li>
              <strong>Your account.</strong> You sign in with Apple or Google, which gives us your
              name and email address. With Apple’s Hide My Email we only receive the relay address.
            </li>
            <li>
              <strong>Identity verification.</strong> Before public sessions we ask you to verify a
              phone number and take a short selfie video; women-only sessions, and coming back after
              a report, also ask for a government ID. Persona, an identity-verification company,
              runs these checks and is the one that receives your number, your selfie and your ID.{" "}
              {SITE.name} does not receive or store any of them. We keep which check it was,
              Persona’s reference for it, and whether it passed.
            </li>
            <li>
              <strong>Your profile.</strong> A first name, your neighbourhood, and the level you set
              for each activity (a pace, a speed, an experience level). You may tell us your gender;
              it is used only to open women-only sessions to women, is never shown to anyone and is
              never used for ranking.
            </li>
            <li>
              <strong>Sessions.</strong> What you post and join, when you cancelled, whether you
              checked in and by which method, and the five yes/no answers people give each other
              afterwards.
            </li>
            <li>
              <strong>Training blocks.</strong> The goal you pick from a short list, an event name
              if you give one, the date, and — counted from your check-ins — how many of your
              sessions you kept. When a block ends, a member who finished can say another member
              helped them stick to it. We keep who said it so it can be taken back; the person it is
              about is never told who.
            </li>
            <li>
              <strong>Messages.</strong> Chat is tied to a single booking and closes a day after the
              session. We keep the messages so a report can be reviewed; a person at {SITE.name}{" "}
              reads a thread only when a report points at it.
            </li>
            <li>
              <strong>Reliability.</strong> Strikes, fees and credits recorded on your account under
              the rules in our Terms.
            </li>
            <li>
              <strong>Location, once.</strong> When you tap Check in, your phone sends its position
              so our server can measure the distance to the meeting pin. We record that you checked
              in and when — not where you were. The app never reads location in the background.
            </li>
          </ul>
          <p>
            We don’t collect your contacts, photos (the verification selfie and ID go to Persona,
            not to us), date of birth, height, weight or relationship status. A training block has
            no weight goal: the miles it shows are the planned distance of the sessions you checked
            in to, separate from any imported workout.
          </p>
        </Section>

        <Section title="Optional Apple Health sync">
          <p>
            Where available, you can choose to connect Apple Health and sync workouts to your
            private SamePace account. A workout includes its source, timestamps, activity, duration,
            and any distance or active energy supplied with it. You may separately select heart
            rate, resting heart rate, heart rate variability, sleep, steps, walking and running
            distance, and active energy readings. Sync starts with the preceding 30 days and imports
            later changes when you request a sync.
          </p>
          <p>
            We use these records to show your private workout history and calculate summaries. They
            do not affect attendance, training-block progress, fees, or your public track record.
            Device permission to connect Apple Health does not itself authorize AI processing or
            sharing with other members. The app’s Terms acceptance separately discloses and
            authorizes bounded workout-summary use for coaching; existing privacy opt-outs remain
            respected. SamePace only reads Apple Health; it does not write or delete anything there.
          </p>
          <p>
            Turning off a reading in SamePace removes that type of imported reading. Removing a
            workout hides it from future routine syncs; we keep its source identifier to prevent it
            from returning. Disconnecting removes all synced health records, related corrections and
            interpretations, and sync identifiers from SamePace. Your separately entered exercise
            logs remain until you remove them or delete your account. Reconnecting starts a new
            import. You can export your imported records and exercise logs from the app, and change
            Apple Health permissions in your device settings. Changing device permissions alone does
            not erase records you already chose to sync.
          </p>
        </Section>

        <Section title="Built-in coaching">
          <p>
            Coaching is included in SamePace. During onboarding you review and accept the current
            Terms and this policy, including the use of relevant records for coaching. We record the
            accepted version and time. There is no model picker or separate AI activation step.
            Existing privacy choices are preserved when you accept updated Terms.
          </p>
          <p>
            The coach sends your conversation and relevant entered planning information to Vercel AI
            Gateway and its AI providers. When useful to your request, it can read up to three
            recently updated private workout plans, three recent workout records and five individual
            exercise logs. These include titles, instructions, notes, planned targets and entered
            actual results. Each plan or record includes at most six exercises and six sets per
            exercise; long records are shortened and identified as incomplete. This is a bounded
            recent sample, not your complete training history.
          </p>
          <p>
            If you have connected Apple Health and allowed its workout summaries for coaching, the
            coach can also use up to five recent imported workouts, with duration, distance, energy
            and an available heart-rate summary. Raw samples, sleep, HRV history and other members’
            records are excluded. Relevance does not override a permission you turned off. General
            questions do not need a history lookup. Locally processed photos and on-device
            conversations are not automatically sent to the cloud.
          </p>
          <p>
            Gateway requests require zero data retention and no prompt training. SamePace keeps
            private coaching history for up to 30 days and at most 80 messages. Clear conversation,
            account deletion or withdrawing a coaching permission removes the relevant app history
            and stops outdated replies. Changes to saved records clear conversations that used those
            records. This cannot retract a reply already seen or data already processed in an
            authorized request. Models are selected by SamePace and may change; suggestions remain
            editable and can be wrong.
          </p>
        </Section>

        <Section title="Exercise logs and structured AI assistance">
          <p>
            You can save private exercises, sets, repetitions, external loads, units, and notes, and
            add corrections alongside imported workouts. Corrections do not change Apple Health. As
            disclosed during Terms acceptance, when you request an exercise suggestion, SamePace
            sends the submitted note or a bounded summary of the selected workout and your stated
            goal to TypeSafe. It does not send your identity, raw heart-rate samples, sleep history,
            or your full health history. Suggestions are editable interpretations, not measurements
            or medical conclusions.
          </p>
          <p>
            Turning AI assistance off stops new requests and removes saved AI interpretations from
            SamePace. Your saved exercise logs and corrections remain yours to edit or remove.
            Account deletion removes all private fitness data. Service reliability counts and
            timings contain no notes, measurements, or member identifiers.
          </p>
          <p>
            A separate, optional feedback pilot records whether suggested fields stayed the same or
            changed when you saved, how long the logging screen was open, and feedback you choose to
            provide. Private comparison fingerprints support later edits; raw notes, exercise values
            and model responses are not copied into these measurements. They expire after 30 days
            and are removed when you leave the pilot, disable AI assistance, delete the related log
            or delete your account. Admin reports show groups of at least five members. Screen
            timings include pauses and do not prove time saved.
          </p>
        </Section>

        <Section title="Workout assistants">
          <p>
            Assistants can coordinate with a workout partner only after both people opt into the
            conversation. Enabling shared planning preferences makes your entered availability,
            activity choices, and approved preference visible in those conversations. Imported
            health records are never included. You can disable preference sharing, withdraw
            conversation consent, or revoke a delegated credential. Both people must separately
            approve the same plan and booking terms before a session is created. Agents cannot
            perform those human approvals.
          </p>
          <p>
            Meeting a new partner requires a separate discovery choice that expires after seven
            days. SamePace compares your entered activity, ability, public venues and available
            times with other opted-in members. Compatible members can see your name and activity and
            invite you to plan. If you choose “women only”, you are shown only to women and only
            shown women. A two-strike pause, or a verification you haven’t done once that is
            required, keeps you out of discovery until it’s sorted. Exact availability and notes
            stay private until you both join the conversation. Editing your preferences pauses
            discovery until you enable it again. Each person separately authorizes any bounded
            assistant planning run; that permission expires and never authorizes booking or payment.
          </p>
        </Section>

        <Section title="Payments and disputes">
          <p>
            When payments are enabled for your local group, Stripe hosts checkout and membership
            management. Card details go to Stripe. SamePace stores provider references, amounts,
            payment states and fee disputes. Every session fee requires a separate checkout; the app
            does not automatically debit fees. Membership credits cannot be withdrawn as cash.
            Billing shows whether collection is available before you begin.
          </p>
          <p>
            Deleting your account queues cancellation and deletion of the Stripe customer and saved
            payment methods. Failed provider requests are retried. Payment and dispute records
            needed for reconciliation remain associated with the anonymized account; Stripe retains
            financial records under its own retention requirements.
          </p>
        </Section>

        <Section title="Who sees what">
          <ul>
            <li>
              <strong>Other members</strong> see your first name, initials, levels and track record
              (sessions completed, on-time rate, would-join-again rate, training blocks finished,
              how many people say you helped them finish one, member since) — and only on a session
              you posted or joined, or a training block you’re in. If you opt into new-partner
              discovery, compatible opted-in members also see your name and activity. There is no
              member directory and no people search.
            </li>
            <li>
              <strong>Your progress in a training block</strong> is yours alone. The others in it
              see a total for the group, never your count.
            </li>
            <li>
              <strong>The exact meeting spot and the check-in code</strong> go only to the people
              confirmed on that session.
            </li>
            <li>
              <strong>Companies that run our infrastructure</strong> process data on our behalf:
              Vercel (hosting), Neon (database), Apple and Google (sign-in), and Persona (identity
              verification), Stripe (payments), Vercel AI Gateway and its model providers (private
              coaching), and TypeSafe (requested structured AI assistance).
            </li>
            <li>We disclose information if the law requires it, or to protect someone’s safety.</li>
          </ul>
        </Section>

        <Section title="Keeping and deleting">
          <p>
            We keep your account data while your account is open. You can delete your account
            yourself, at any time, in the app: <strong>You → Delete account</strong>. It takes
            effect immediately. If you can’t get into the app, email <SupportEmail /> from the
            address on your account and we’ll do it for you.
          </p>
          <p>
            Deleting removes your sign-in, your name, neighborhood, level and the rest of your
            profile, your messages, your block list, and any sessions or seats you had coming up.
            What stays is what belongs to other people’s history too: that a session happened and
            who showed up, any fee tied to it, ratings you gave, and any safety report — along with
            the thread it points at. Those are shown against “Deleted member”, never your name. If
            an account was removed for breaking the rules, we keep a scrambled fingerprint of its
            email address, and nothing else, so it can’t simply be opened again.
          </p>
          <p>
            <strong>Verification.</strong> When you delete your account we ask Persona to delete the
            selfie, number and ID it holds for you. Local verification records and badges are
            removed immediately. Only the provider reference needed to retry a failed deletion
            remains queued until Persona confirms deletion.
          </p>
          <p>
            <strong>Reports and blocks.</strong> When you report someone we store the report, who it
            is about, and the session or planning invitation it concerns. The person you report or
            block isn’t told.
          </p>
        </Section>

        <Section title="Your choices">
          <ul>
            <li>You can decline location access and check in with the session code instead.</li>
            <li>You can leave your gender unset; you then won’t see women-only sessions.</li>
            <li>
              You can ask for a copy of your data, a correction, or deletion. Depending on where you
              live you may have further rights; write to us and we’ll honour them.
            </li>
          </ul>
        </Section>

        <Section title="Age">
          <p>
            {SITE.name} is for adults. You must be 18 or older to use it, and we don’t knowingly
            collect data from anyone younger.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            If we change this policy in a way that matters, we’ll tell you in the app before it
            takes effect. Questions: <SupportEmail />
          </p>
        </Section>
      </Prose>
    </SiteShell>
  );
}
