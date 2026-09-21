/** The signing identity already used by SamePace's iPhone distribution builds. */
export const IOS_APP_ID = "NZBE9W77FA.app.samepace";
export const ANDROID_PACKAGE = "app.samepace";

export function appleAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [
            "/invite/*",
            "/session/*",
            "/training-block/*",
            "/verified",
            "/billing-return",
          ].map((path) => ({ "/": path })),
        },
      ],
    },
  };
}

/** Never publish a guessed/debug signing certificate as a production association. */
export function androidAssociation(configured: string | undefined) {
  if (!configured?.trim()) return [];
  const fingerprints = configured.split(",").map((value) => value.trim().toUpperCase());
  if (fingerprints.some((value) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))) {
    throw new Error("Android App Links signing fingerprints are not configured correctly.");
  }
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [...new Set(fingerprints)],
      },
    },
  ];
}

export function appleAssociationResponse() {
  return Response.json(appleAssociation(), {
    headers: { "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" },
  });
}

export function androidAssociationResponse(
  configured = process.env.APP_LINK_ANDROID_SHA256_FINGERPRINTS,
) {
  try {
    const association = androidAssociation(configured);
    return Response.json(association, {
      headers: {
        "cache-control": association.length ? "public, max-age=300" : "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Android App Links are not configured." },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
