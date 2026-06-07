import { NextRequest, NextResponse } from "next/server";
import { enforceSameOrigin, rateLimit, sanitizeApiError } from "@/utils/api/security";

const KIT_API_KEY = process.env.KIT_API_KEY || process.env.KIT_API_SECRET;
const KIT_FORM_ID = process.env.KIT_FORM_ID;
const WAITLIST_EMAIL_MAX_LENGTH = 254;

export async function POST(request: NextRequest) {
  const originError = enforceSameOrigin(request);
  if (originError) return originError;

  const rateLimitError = await rateLimit({
    key: "waitlist",
    limit: 5,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  if (!KIT_API_KEY || !KIT_FORM_ID) {
    return NextResponse.json(
      { error: "Waitlist is temporarily unavailable" },
      { status: 500 }
    );
  }

  try {
    const { email } = await request.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (
      normalizedEmail.length > WAITLIST_EMAIL_MAX_LENGTH ||
      !emailRegex.test(normalizedEmail)
    ) {
      return NextResponse.json(
        { error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `https://api.convertkit.com/v3/forms/${KIT_FORM_ID}/subscribe`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          api_key: KIT_API_KEY,
          email: normalizedEmail,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Kit API error:", errorData);
      
      if (response.status === 404) {
        return NextResponse.json({ error: "Waitlist is temporarily unavailable" }, { status: 500 });
      }
      
      if (response.status === 422) {
        return NextResponse.json(
          { success: true, message: "You're already on the waitlist!" },
          { status: 200 }
        );
      }

      return NextResponse.json(
        { error: "Failed to join waitlist. Please try again later." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, message: "You're on the waitlist!" },
      { status: 201 }
    );
  } catch (error) {
    return sanitizeApiError("Waitlist API error:", error, "Something went wrong. Please try again later.");
  }
}
