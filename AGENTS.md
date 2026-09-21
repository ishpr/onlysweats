# SamePace project guidance

## TypeSafe and Jev

Use the project-installed [TypeSafe skill](.agents/skills/typesafe-ai/SKILL.md) for AI-assisted fitness tracking, matching, and agent behavior. Read its current documentation and relevant cookbook before choosing questions or integrating the SDK. The installation is recorded in `skills-lock.json`.

Keep measured workout facts, deterministic calculations, and model interpretations distinct. Jev may supply typed semantic judgments; code owns counting, arithmetic, time comparisons, eligibility, consent, permissions, revisions, and execution. Missing sensor data remains missing. Never present prototype or synthetic health data as measured activity.

Follow [the Apple Health guide](docs/APPLE-HEALTH.md) for the implemented import layer, [the fitness integration design](docs/JEV-FITNESS.md) for proposed inference, and [the A2A guide](docs/A2A.md) for the negotiation boundary. Jev fitness inference is not implemented yet. Do not describe documentation or fixtures as a live integration.

Keep API keys server-side. Use bounded, relevant, explicitly authorized state. A2A delegation does not confer permission to read or share raw health data. Model confidence never substitutes for authorization or proves a physiological conclusion.
