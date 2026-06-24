import { NextResponse } from "next/server";

export function GET(request: Request) {
  return NextResponse.redirect(new URL("/brand/tabIcon.png", request.url), 308);
}