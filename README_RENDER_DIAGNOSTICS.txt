Render diagnostics checklist:

1) Verify backend root is reachable:
   GET https://internshala-clone-y2p2.onrender.com/

2) Verify API base routes:
   GET https://internshala-clone-y2p2.onrender.com/api/health
   GET https://internshala-clone-y2p2.onrender.com/api/routes

3) Verify job/internship:
   GET https://internshala-clone-y2p2.onrender.com/api/job
   GET https://internshala-clone-y2p2.onrender.com/api/internship

If /api/routes is 404, Render is not running the expected backend code.
If /api/routes works but /api/job is 404, routing is different (mount path mismatch) and we’ll patch mount/router accordingly.

