export async function onRequestPost(context) {
  try {

    const body = await context.request.json();
    const passcode = String(body.passcode || "");

    if (passcode !== context.env.VAULT_PASSCODE) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Invalid passcode"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {

    console.error("Login error:", error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid request"
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  }
}
