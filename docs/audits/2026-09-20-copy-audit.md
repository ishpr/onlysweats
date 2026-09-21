# Copy and comprehension audit — 2026-09-20 (condensed)

Adversarial read of every user-facing string as a first-time user. Full detail was
reviewed in session; this is the working fix list.

## Glossary — one word per concept, everywhere (UI, push, errors, website, Terms)

| Concept | Use | Never |
| --- | --- | --- |
| The planned workout | **session** | listing, "this one", "the one", occurrence |
| A place in it | **spot** ("2 spots left") | seat, place, cap |
| Where you meet | **meeting point** | pin, meeting pin, meeting spot |
| Who created it | **host** (or their first name) | poster |
| Who joined | **buddy** (friendly) / **member** (rules) | joiner |
| Become part of it | **Join** / **Joined** | "I'm in", "You're in", "is in", hold |
| Needs approval | **Ask to join** / **Waiting for approval** / Approve / Decline | "wasn't taken up", lapses |
| Creating one | button "Post session"; screen "New session" | "Open a seat", "the one you're doing anyway" |
| Leaving | joiner **Leave session**; host **Cancel session**; weekly **Skip this week** | "Give up my seat", "Cancel listing", "Call it off", released |
| Repeats weekly | **weekly session**; people in it **regulars** | standing slot, slot, series |
| One-week replacement | **fill-in spot** | substitute seat, covered |
| Level | **Any level welcome** (exact is the default) | flexible / strict |
| Visibility | **Public** / **Invite-only** | Unlisted |
| Arrival proof | **check-in**; "opens 20 min before, closes 25 min after" | window, "live session", "Live" |
| Fallback | **backup code** | session code |
| Penalties | late-cancel fee ($5), no-show fee ($10), **strike** — define inline once per screen | bare "a strike" |
| Admin action | **account suspended** | paused (collides with the 14-day freeze) |
| 1:1 messages | **chat** | thread |
| Notification list | **Notifications** | Activity (collides with Run/Ride) |
| Strength | **Gym** | strength, lift |
| Units | miles / feet | m, metres |

## Ten worst
1. Post headline "You're going anyway. Open N seats." — delete; nav title is enough.
2. Prefilled title/description ("The one I'm doing anyway", "Join if you'll be at the pin") — start empty with placeholders; they poison cards, widget, share text and every push.
3. "Post the workout you're doing anyway" as the fallback line on every dead end — lead with finding a buddy.
4. "Seat" (~40 uses) → spot.
5. "The pin" → meeting point (reads as a PIN code next to a 4-digit code).
6. "Standing slot" / "substitute seat" / occurrence / "a regular out" → weekly session / fill-in spot.
7. Joining can cost money and nothing says so at the moment of commitment; "I'm in" confirms instantly; the app states $5/$10/$12 as real while Terms say nothing is charged today.
8. A session you post disappears: Today and the widget are built from bookings only; an invite-only post with no joiners is unreachable; nothing after posting says what happens next.
9. Auto-messages are inserted as chat bubbles *from the host* who never typed them ("I'll confirm if it still fits") — render as system lines.
10. Check-in screen is insider shorthand: "Live session", "Window", "412 m out — get inside 150 m", "Trails drop GPS", "Reveal code"; "You're in" means checked-in here and joined elsewhere; metres for a US audience.

Runners-up: smug push "You showed up. They didn't."; one tap on "Same time next week" silently commits the OTHER person to a weekly session with fees, and there is no "Leave weekly session" control in the app; Inbox "Activity" means notifications.

## Bugs surfaced by the copy read
- Raw zod errors reach users (`title: Too small: expected string…`) — map per field (`src/lib/pace/http.server.ts`).
- Raw enums printed: session status badge, `venue.type` ("road start"), `This seat is host no show`, suspension reason `Report: date_framing`.
- Invite screen can render "undefined opened a seat".
- Today credit card prints `$7.5` (use `formatUsd`); greeting shows "Member".
- Every new member is "Oak Lawn" with no way to change it.
- Rating: "Showed up" is always yes (asked only after both checked in); all answers default to Yes; no thank-you after submit.
- Duration is never asked on Post (silently per activity); pace bands stop at 7:00–13:00.
- Inbox badge counts my own pending requests; host with two joiners sees the session twice on Today.
- Privacy policy says location is read "only when you tap Check in" but the screen watches position while open — align the text.
- Banned words in user copy: "Made it feel like a date" (report reason), "Code doesn't match", "matched" on You (already removed).
- Lock-screen pushes expose penalties and "a report"; the 1-hour reminder reads as a threat and is wrong for hosts.

## Says nothing but should
First-run (level, name, how check-in and fees work) · after posting · after joining ("free to cancel until X") · after approve/decline · after rating · consent + leave control for weekly sessions · a fees-and-strikes detail view with dispute link · why a session is "Closed" · "Dallas only for now" on the place picker.
