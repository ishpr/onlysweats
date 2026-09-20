import type { Person, Venue } from "./types";

export const byId = <T extends { id: string }>(items: T[] | undefined) =>
  new Map((items ?? []).map((x) => [x.id, x]));

export type PeopleMap = Map<string, Person>;
export type VenueMap = Map<string, Venue>;
