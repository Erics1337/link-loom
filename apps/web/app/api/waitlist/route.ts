import { NextRequest, NextResponse } from "next/server";

const KIT_API_KEY = process.env.KIT_API_KEY || process.env.KIT_API_SECRET;
const KIT_FORM_ID = process.env.KIT_FORM_ID;

export async function POST(request: NextRequest) {
  if (!KIT_API_KEY || !KIT_FORM_ID) {
    return NextResponse.json(
      { error: "Kit integration not configured" },
      { status: 500 }
    );
  }

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
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
          email,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Kit API error:", errorData);
      
      if (response.status === 404) {
        return NextResponse.json(
          {
            error:
              "Kit form not found. Check that KIT_FORM_ID is the numeric form ID from Kit, not the embed data-uid.",
          },
          { status: 500 }
        );
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
    console.error("Waitlist API error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again later." },
      { status: 500 }
    );
  }
}
