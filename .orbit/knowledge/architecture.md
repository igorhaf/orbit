# Orbit architecture

Orbit uses Next.js App Router with React, Tailwind, and dnd-kit. The NestJS API
uses PostgreSQL through `pg` with parameterized SQL. Board membership is checked
in `FeaturesService`. Cards belong to lists, and lists belong to boards.
The server publishes board changes through Socket.IO. Automation events are
durable PostgreSQL records. Optional card execution lives under
`apps/api/src/execution`; existing prompt sessions remain independent.
