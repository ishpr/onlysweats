# Visual walkthrough audit — 2026-09-20 (condensed)

Driven on the iPhone simulator; 89 screenshots. Cut short when another session
changed the app's API port mid-run (see "Coverage gaps").

Verdict: two things look designed — the photo session card and the rings header on
You. Almost everything else is one component repeated: a grey rounded card with a
15 pt label and a 13 pt grey caption. Nothing tells the eye what matters, and the
core journey (find → commit → get the meeting point → show up) has no high points.

## Ten most damaging
1. **P0** Join has no confirmation and no success moment: one tap commits you to fee rules, then drops you in a chat titled "Thread".
2. **P0** Session detail is seven identical grey cards; the join button is below the fold and not pinned; the time — what people decide on — is a 15 pt label in a small card.
3. **P0 (tone)** "Report or block {Name}" is the loudest thing in the host card and the chat header, before you've even joined. Move to an overflow menu.
4. **P0** Post is a form dump: nine clipped chip scrollers with no fade ("Mol", "8:3"), the selected pace starts off-screen, two radio groups share one row, 17 hour chips + 4 minute chips, past times selectable, duration invisible, button at the bottom of 2.3 screens, modal has no close.
5. **P0 (bug)** A refresh spinner sticks on tab focus and shoves content down ~60 pt (Sessions, You): `RefreshControl` bound to `isRefetching` while focus invalidates queries.
6. **P0** Raw server error text shown to users ("Only HTML requests are supported here").
7. Inbox red badge counts my own outgoing requests; nothing is marked new.
8. Discovery cards all look alike: same dusk photo per venue, top half empty, a Full or already-requested session renders at full weight, eyebrow illegible on bright photos, level fit never shown.
9. Disabled destructive buttons stay saturated red (look armed, ~2:1 contrast).
10. No single language for buttons (white vs green vs grey primary), headers (three styles), selection (white fill / green outline / typed ✓), section headings, time format, status words, chevrons (push / expand / web / sign out).

## Bugs
B1 stuck spinner on tab focus · B3 "Listing and pin" pushes a second session screen (three backs to exit) · B4 badge counts own requests · B5 "Change my name" inserts its editor off-screen at the top · B6 Post accepts a past time · B7 (seen once) first "Cancel listing" after posting dismissed with no dialog — suspect `router.replace` from inside the modal · B8 notification switches ignored taps on the simulator (check on device) · B9 a pending request shows the session as Full with no "Requested" marker on my own card · chat input is single-line and not in Outfit · forced capitalisation garbles meta ("45 Min", "2 Cap") · "Set" reads as already set · membership dots look like a pager · Walk reuses Run's icon.

## Redesign first
1. **Session detail in all four states** (visitor, requested, joined, host) + the join moment: one decision block (big day · time · duration, level with fit badge, host's rings, place with map), pinned button + one-line terms, confirm sheet → success state, status banner, meeting-point card that visibly unlocks with Open in Maps + add to calendar, host state with "Posted" + Share, report/block in an overflow.
2. **Post**: three steps with a live preview card, real time picker (past disabled), visible duration, venue photos, segmented controls, generated titles, close button, pinned primary.
3. **Today + the card system**: hero = my next session (countdown, meeting point, chat + check-in); "Waiting on you"; "At your level · next 48 h" without what I already hold; date grouping, compact variant, fit tag, Full/Requested/Yours treatments, varied photos, guaranteed scrim.

## Coverage gaps
Not seen: live check-in, host approve/decline, invite/share on an invite-only post, "N more outside your level", Activity with entries, loading skeletons, chat with the software keyboard up.
