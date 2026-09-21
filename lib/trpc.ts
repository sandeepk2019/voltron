import { createTRPCReact } from "@trpc/react-query";

// Keep mobile builds independent from the web repository's server path aliases.
// The shared API contract can be generated into this project as part of mobile auth wiring.
export const trpc = createTRPCReact<any>();

export const BACKEND_URL = "https://3000-ik6yndjw6etkumpv8rpmz-85b2c519.sg2.manus.computer";
