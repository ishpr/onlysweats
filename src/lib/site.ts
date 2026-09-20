/** Facts the public site states in more than one place. */
export const SITE = {
  name: "SamePace",
  url: "https://samepace.vercel.app",
  /** Where members reach a person. Shown on Support and in both policies. */
  supportEmail:
    (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || "support@samepace.app",
  /** The app's URL scheme — invite links hand off to it. */
  appScheme: "samepace",
  cluster: "Dallas — the Katy Trail and Oak Lawn",
  /** Shown on the policies. Update when their substance changes. */
  policiesUpdated: "September 20, 2026",
} as const;
