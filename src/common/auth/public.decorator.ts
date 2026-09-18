import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Marks a route as not requiring a JWT (e.g. login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
