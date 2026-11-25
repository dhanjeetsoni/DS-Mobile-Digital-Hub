Deno.serve(() => Response.json({ error: "retired debug probe" }, { status: 410 }));
