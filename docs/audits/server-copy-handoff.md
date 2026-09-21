# Server-written copy: what to change (hand-off for the server/API owner)

The app's own screens now use one vocabulary (see the glossary in
`2026-09-20-copy-audit.md`). These strings are written by the server and reach members
verbatim — in push notifications, chat, and error messages — so they still use the old
words. File references are to `main`; line numbers drift, search for the string.

**Glossary in one line:** session · spot (not seat) · meeting point (not pin) · host (not
poster) · buddy/member (not joiner) · Join / Joined · Leave session · Cancel session
(not "called off") · weekly session (not standing slot) · fill-in spot (not substitute
seat) · goal (not training block, in anything a member reads) · chat (not thread) ·
account suspended (not paused) · feet/miles (not metres).

## 1. Auto-messages stored as if the host wrote them — `service.server.ts`
Insert these with a system sender (or a `system: true` flag) instead of `from_id = host`.
The app already renders the three current texts as notes, matching on their first words,
so change the text and the flag together.
| Now | Use |
| --- | --- |
| `You’re in. The exact pin is on the session. See you there.` | `Joined. The meeting point is on the session page.` |
| `Request received. I’ll confirm if it still fits.` | `Request sent. {Host} will approve or decline.` |
| `Same time next week. See you there.` | `This repeats next week, same time.` |

## 2. Push notifications — `service.server.ts`, `safety.server.ts`, `notify.server.ts`
Must make sense cold on a lock screen; never put a penalty or "a report" in the title.
| Kind | Now | Use (title / body) |
| --- | --- | --- |
| `session_cancelled` | `Called off: {title}` / `…Your seat is released and nothing is charged.` | `Cancelled: {title}` / `{Host} cancelled {day time}. You won’t be charged anything.` |
| `seat_taken` | `{name} is in` / `…Say hi and sort out the details.` | `{name} joined your {activity}` / `{day time} at {venue}. Say hi.` |
| `seat_requested` | `…Approve or decline — an unanswered request lapses at the start.` | `{title} · {when}. Tap to approve or decline.` |
| `seat_approved` | `You’re in` / `…exact meeting spot…` | `{Host} approved you` / `{title} · {when}. The meeting point is now on the session page.` |
| `seat_declined` | `Not this one` / `…wasn’t taken up…` | `Request declined` / `{Host} couldn’t add you to {title}. Nothing is charged.` |
| `seat_cancelled` | `…The seat is open again.` | `…The spot is open again.` |
| `substitute_offer` | `A seat opened at your level` / `…filling in for a regular.` | `A weekly group needs a fill-in` / `{activity} · {when} · {level} at {venue}. This week only.` |
| `no_show` | `Missed session: $10 fee and a strike` | `We didn’t see you check in` / `{title}, {when}. That counts as a no-show: a $10 fee and a strike. If you were there, reply to support@samepace.app within 24 hours and we’ll fix it.` |
| `stood_up` | `You showed up. They didn’t.` | `Sorry your buddy didn’t make it` / `We’ve added $5 credit to your account for {title}.` |
| `frozen` | `Public sessions are paused for 14 days` | `An update about your account` / `Public sessions are paused until {date} after two no-shows in 60 days. Sessions friends invite you to still work.` |
| `suspended` | `Your account is paused` / `…after reviewing a report…` | `An update about your account` / `Open SamePace for details.` |
| `session_removed` | `…broke the rules for what can be posted.` | `…didn’t follow our posting rules ({reason}). Email support@samepace.app if that’s wrong.` |
| `next_occurrence` | `Same time next week is on` | `{Name} made {title} weekly` / `Next one: {day time}. Skip any week for free up to 12 hours before, or leave any time.` |
| `starts_soon` | `…Cancelling now costs $5 unless someone takes the seat — a no-show is $10 and a strike.` | `In 1 hour: {title}` / `{venue} with {buddy}. Check-in opens at {time}.` (no fee text; it's wrong for hosts and reads as a threat) |
| `checkin_open` | `…when you’re at the pin — it closes 25 minutes after the start.` | `Time to check in` / `{title} at {venue}. Open the app when you arrive — check-in closes at {time}.` |
| training-block pushes | "block", "slot", "seat" | "goal", "weekly session", "spot" |

## 3. Rule rejections shown verbatim — `rules.ts`
| Now | Use |
| --- | --- |
| `Say what level this one is.` | `Choose a level for this session.` |
| `Give it a title.` | `Add a name for your session.` |
| `Pick a start at least 30 minutes out.` | `Choose a start time at least 30 minutes from now.` |
| `Sessions stay between 2 and 4 people.` | `Sessions are for 2 to 4 people.` |
| `Public sessions are paused for 14 days after two no-shows.` | `Your public sessions are paused until {date}. You can still use invite links.` |
| `Women-only sessions are posted by women.` | `Only women can post women-only sessions. Set your gender under You.` |
| `You posted this one.` | `This is your session.` |
| `This one already started.` / `It already started.` | `This session has already started.` |
| `You’re already in.` | `You’ve already joined this session.` |
| `It’s full.` | `This session is full.` |
| `Outside the check-in window.` | `Check-in is open from {from} to {to}.` |
| `GPS is too loose here. Use the session code.` | `GPS isn’t accurate enough here. Use the backup code instead.` |
| `You’re {n} m out. Get inside 150 m.` | `You’re about {x ft/mi} from the meeting point. Check-in works within 500 ft.` |
| `The code hasn’t been revealed yet.` | `Ask {Host} to tap “Show code” first.` |
| `Code doesn’t match.` | `That code isn’t right. Check it and try again.` (also removes a banned word) |

## 4. Service errors — `service.server.ts`, `safety.server.ts`, `http.server.ts`
- `No profile.` / `No booking.` / `No session.` / `No such member.` / `Session not found.` → `We couldn’t find that. It may have been cancelled.`
- `That session is gone.` → `This session isn’t available any more.`
- `Pick a venue in the cluster.` → `Choose a place from the list.`
- `Only the poster can approve.` / `…decline.` → `Only the host can do that.`
- `Not your seat.` / `Nothing to cancel.` → `This was already cancelled.`
- `A standing slot starts from a session you both showed up to.` → `You can make a session weekly after you’ve both checked in.`
- `That standing slot has ended.` / `Not your standing slot.` → `This weekly session has ended.` / `You’re not in this weekly session.`
- `Thread closed.` / `This thread is closed.` / `This thread expired.` → `This chat is closed.` / `This chat closed a day after the session.`
- `Say something.` → `Type a message first.` · `That’s you.` → `You can’t block or report yourself.`
- `Your account is paused. Email support@samepace.app.` → `Your account is suspended. Email support@samepace.app.`
- **Zod errors are passed through raw** (`title: Too small: expected string…`). Map per field to a sentence. The app now hides these behind a generic message as a stopgap (`mobile/src/lib/api.ts`), so members no longer see them — but a real per-field message is better.
- The suspension reason defaults to `Report: date_framing` (a raw enum, shown to the member). Keep the admin's note and the member-facing reason separate, and map the enum to a sentence.

## 5. Behaviour the app now assumes or wants (not copy)
- **Consent for "make it weekly".** One tap still commits the other person to weekly sessions with fees. The app's card now says so; the server should require the other member to accept.
- **A lapsed request is not a decline.** Give it its own status (or a flag) so the app can say "wasn't answered".
- **Rating `showedUp`.** The app no longer asks it (both checked in, so it's always true) and sends `true`.
- **Local dev:** the shared checkout's API is on an old branch without goals — `POST /training-blocks` 404s locally.

## 6. New screens (health, fitness, assistant, billing) — server-written text
- Billing: `Payments are not enabled for this account and cluster.` → `Payments aren’t open in your area yet.` ("cluster" is internal). The app already says payment isn't available, so return one reason, not two.
- Anything that says "on this server" is developer-speak to a member: say "isn’t available yet".
- The app now says **buddy** everywhere a member reads it (the assistant screens said "partner"); keep server-written assistant and discovery text the same.
- Sign-ups through Google can arrive with the email's local part as the name (`eprasad7`). Don't derive a name from an email at all — leave it as `Member`; the app asks for a first name.
