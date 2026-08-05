const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const AdminConfig = require("../Model/AdminConfig");
const adminuser = process.env.ADMIN_USER || "admin";
const adminpass = process.env.ADMIN_PASS || "admin";

module.exports = router;

/**
 * POST /api/admin/adminlogin
 *
 * Authenticates admin using either:
 * 1. Env-var credentials (ADMIN_USER / ADMIN_PASS) - fallback/initial
 * 2. DB-stored password hash (set via password reset flow)
 */
router.post("/adminlogin", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required.",
    });
  }

  // First, check env-var credentials (fast path, backward compatible)
  if (username === adminuser && password === adminpass) {
    return res.status(200).json({
      success: true,
      message: "Admin login successful",
    });
  }

  // If env-var check fails, check DB-stored credential (from password reset)
  try {
    const config = await AdminConfig.findById("admin_config");
    if (config && config.passwordHash && username === adminuser) {
      const isMatch = await bcrypt.compare(password, config.passwordHash);
      if (isMatch) {
        return res.status(200).json({
          success: true,
          message: "Admin login successful",
        });
      }
    }
  } catch (err) {
    console.error("[adminLogin] DB credential check error:", err.message);
    // Fall through to generic failure
  }

  return res.status(401).json({
    success: false,
    message: "Invalid credentials",
  });
});
