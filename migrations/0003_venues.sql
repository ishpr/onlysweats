-- Launch cluster: Dallas parks and trails (running first — PRD v0.3 §12).
-- Reference data, safe in production.
insert into venues (id, name, type, neighborhood, lat, lng, image, hint) values
  ('katy', 'Katy Trail — Reverchon', 'trail', 'Uptown', 32.8019, -96.8074,
   '/venues/katy-trail.jpg', 'East-side pin at the stone trailhead. Parking fills after 6:10.'),
  ('whiterock', 'White Rock Lake — Sunset Bay', 'park', 'East Dallas', 32.8332, -96.7281,
   '/venues/white-rock.jpg', 'Loop starts at the bay overlook. Watch the geese on the path.'),
  ('trinity', 'Trinity Forest Trail', 'trail', 'South Dallas', 32.7124, -96.7558,
   '/venues/trinity-trail.jpg', 'Trailhead lot off Great Trinity Forest Way. GPS drops under canopy.'),
  ('turtle', 'Turtle Creek Greenbelt', 'park', 'Oak Lawn', 32.8041, -96.8079,
   '/venues/turtle-creek.jpg', 'Meet at the limestone bend, not the gym lot.')
on conflict (id) do nothing;
