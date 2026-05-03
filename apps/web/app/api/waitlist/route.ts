import { NextRequest, NextResponse } from "next/server";

const KIT_API_SECRET = process.env.KIT_API_SECRET;
const KIT_FORM_ID = process.env.KIT_FORM_ID;

export async function POST(request: NextRequest) {
  if (!KIT_API_SECRET || !KIT_FORM_ID) {
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address" },
        { status: 400 }
      );
    }

    // Subscribe to Kit form using their API
    // Kit API docs: https://developers.kit.com/
    const response = await fetch(
      `https://api.kit.com/v4/forms/${KIT_FORM_ID}/subscribers`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${KIT_API_SECRET}`,
        },
        body: JSON.stringify({
          email_address: email,
          state: "active",
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Kit API error:", errorData);
      
      // Handle duplicate subscriber gracefully
      if (response.status === 422 && errorData.message?.includes("already subscribed")) {
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
