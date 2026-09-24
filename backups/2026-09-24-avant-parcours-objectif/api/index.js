var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/db/pool.js
var require_pool = __commonJS({
  "src/db/pool.js"(exports2, module2) {
    var { Pool } = require("pg");
    var pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
    pool.on("error", (err) => {
      console.error("Erreur inattendue sur le pool PostgreSQL :", err);
    });
    module2.exports = pool;
  }
});

// src/routes/auth.js
var require_auth = __commonJS({
  "src/routes/auth.js"(exports2, module2) {
    var express2 = require("express");
    var bcrypt = require("bcryptjs");
    var jwt = require("jsonwebtoken");
    var rateLimit = require("express-rate-limit");
    var pool = require_pool();
    var router = express2.Router();
    var loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1e3,
      limit: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Trop de tentatives de connexion. Merci de r\xE9essayer dans quelques minutes." }
    });
    router.post("/login", loginLimiter, async (req, res) => {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: "Email et mot de passe requis." });
      }
      try {
        const result = await pool.query(
          `SELECT u.id, u.email, u.password_hash, u.role, u.account_id,
              a.name AS account_name, a.brand_label, a.portal_name,
              a.modules, a.activation_enabled, a.pricing, a.billing_info, a.targeting_catalog,
              a.cta_banner, a.dashboard_metrics
       FROM users u
       LEFT JOIN accounts a ON a.id = u.account_id
       WHERE lower(u.email) = lower($1)`,
          [email]
        );
        const user = result.rows[0];
        if (!user) {
          return res.status(401).json({ error: "Identifiants incorrects." });
        }
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
          return res.status(401).json({ error: "Identifiants incorrects." });
        }
        const token = jwt.sign(
          { accountId: user.account_id, email: user.email, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );
        res.json({
          token,
          role: user.role,
          account: user.account_id ? {
            id: user.account_id,
            name: user.account_name,
            brandLabel: user.brand_label,
            portalName: user.portal_name,
            modules: user.modules,
            activationEnabled: user.activation_enabled,
            pricing: user.pricing,
            billingInfo: user.billing_info,
            targetingCatalog: user.targeting_catalog,
            ctaBanner: user.cta_banner,
            dashboardMetrics: user.dashboard_metrics
          } : null
        });
      } catch (err) {
        console.error("Erreur /auth/login :", err);
        res.status(500).json({ error: "Erreur serveur, merci de r\xE9essayer." });
      }
    });
    module2.exports = router;
  }
});

// src/middleware/auth.js
var require_auth2 = __commonJS({
  "src/middleware/auth.js"(exports2, module2) {
    var jwt = require("jsonwebtoken");
    function requireAuth(req, res, next) {
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) {
        return res.status(401).json({ error: "Authentification requise." });
      }
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        next();
      } catch (err) {
        return res.status(401).json({ error: "Session invalide ou expir\xE9e, merci de vous reconnecter." });
      }
    }
    function requireAdmin(req, res, next) {
      if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ error: "Acc\xE8s r\xE9serv\xE9 \xE0 l'\xE9quipe AutoLead." });
      }
      next();
    }
    module2.exports = { requireAuth, requireAdmin };
  }
});

// src/routes/leads.js
var require_leads = __commonJS({
  "src/routes/leads.js"(exports2, module2) {
    var express2 = require("express");
    var pool = require_pool();
    var { requireAuth } = require_auth2();
    var router = express2.Router();
    router.use(requireAuth);
    var VALID_STATUSES = ["transmis", "contacte", "rdv_pris", "honore", "perdu"];
    function withComputedFields(row) {
      const hoursWaiting = row.status === "perdu" || row.status === "honore" ? 0 : Math.max(0, Math.round((Date.now() - new Date(row.created_at).getTime()) / 36e5));
      return { ...row, hoursWaiting };
    }
    router.get("/", async (req, res) => {
      try {
        const result = await pool.query(
          `SELECT id, center_id AS "centerId", nom, tel, cp, gene, source, status,
              rdv_date AS "rdvDate", rdv_time AS "rdvTime", created_at
       FROM leads
       WHERE account_id = $1
       ORDER BY created_at DESC`,
          [req.user.accountId]
        );
        res.json(result.rows.map(withComputedFields));
      } catch (err) {
        console.error("Erreur GET /leads :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.get("/:id", async (req, res) => {
      try {
        const leadResult = await pool.query(
          `SELECT id, center_id AS "centerId", nom, tel, cp, gene, source, status,
              rdv_date AS "rdvDate", rdv_time AS "rdvTime", created_at
       FROM leads WHERE id = $1 AND account_id = $2`,
          [req.params.id, req.user.accountId]
        );
        const lead = leadResult.rows[0];
        if (!lead) return res.status(404).json({ error: "Lead introuvable." });
        const historyResult = await pool.query(
          `SELECT text, created_at AS ts FROM lead_history WHERE lead_id = $1 ORDER BY created_at ASC`,
          [req.params.id]
        );
        res.json({ ...withComputedFields(lead), history: historyResult.rows });
      } catch (err) {
        console.error("Erreur GET /leads/:id :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/:id/status", async (req, res) => {
      const { status } = req.body || {};
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Statut invalide. Valeurs possibles : ${VALID_STATUSES.join(", ")}` });
      }
      try {
        const result = await pool.query(
          `UPDATE leads SET status = $1, updated_at = now()
       WHERE id = $2 AND account_id = $3
       RETURNING id`,
          [status, req.params.id, req.user.accountId]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Lead introuvable." });
        await pool.query(
          `INSERT INTO lead_history (lead_id, text) VALUES ($1, $2)`,
          [req.params.id, `Statut pass\xE9 \xE0 ${status}.`]
        );
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH /leads/:id/status :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/:id/rdv", async (req, res) => {
      const { rdvDate, rdvTime } = req.body || {};
      try {
        const result = await pool.query(
          `UPDATE leads SET rdv_date = $1, rdv_time = $2, updated_at = now()
       WHERE id = $3 AND account_id = $4
       RETURNING id`,
          [rdvDate || null, rdvTime || null, req.params.id, req.user.accountId]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Lead introuvable." });
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH /leads/:id/rdv :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.post("/:id/notes", async (req, res) => {
      const { text } = req.body || {};
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "Le texte de la note est requis." });
      }
      try {
        const owns = await pool.query(
          `SELECT 1 FROM leads WHERE id = $1 AND account_id = $2`,
          [req.params.id, req.user.accountId]
        );
        if (!owns.rows.length) return res.status(404).json({ error: "Lead introuvable." });
        await pool.query(
          `INSERT INTO lead_history (lead_id, text) VALUES ($1, $2)`,
          [req.params.id, `Note : ${text.trim()}`]
        );
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur POST /leads/:id/notes :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    module2.exports = router;
  }
});

// src/pricing.js
var require_pricing = __commonJS({
  "src/pricing.js"(exports2, module2) {
    var CAMPAIGN_PRICING = { collecte: 25, requalif: 45 };
    var LOCATION_PRICE_PER_CONTACT = 0.35;
    var NOTORIETE_CPM = 100;
    var SMS_CPM_DEMO = 120;
    var SMS_CPM_PREMIUM = 150;
    var EMAIL_CPM_DEMO = 40;
    var EMAIL_CPM_PREMIUM = 70;
    var EMAIL_CREA_PRICE = 350;
    var ACTIVATION_BASE_CPM = 14;
    var ACTIVATION_EXTRA_CPM = 5;
    var ACTIVATION_MIN_INVOICE = 500;
    function accountPrices(account) {
      const p = account && account.pricing || {};
      return {
        collecte: p.collecte ?? CAMPAIGN_PRICING.collecte,
        requalif: p.requalif ?? CAMPAIGN_PRICING.requalif,
        location: p.location ?? LOCATION_PRICE_PER_CONTACT,
        notoriete: p.notoriete ?? NOTORIETE_CPM,
        smsDemo: p.smsDemo ?? SMS_CPM_DEMO,
        smsPremium: p.smsPremium ?? SMS_CPM_PREMIUM,
        emailDemo: p.emailDemo ?? EMAIL_CPM_DEMO,
        emailPremium: p.emailPremium ?? EMAIL_CPM_PREMIUM,
        emailCrea: p.emailCrea ?? EMAIL_CREA_PRICE,
        activationBase: p.activationBase ?? ACTIVATION_BASE_CPM,
        activationExtra: p.activationExtra ?? ACTIVATION_EXTRA_CPM,
        activationMin: p.activationMin ?? ACTIVATION_MIN_INVOICE
      };
    }
    function isPresetActive(targeting, preset) {
      const sameSet = (a, b) => JSON.stringify([...a || []].sort()) === JSON.stringify([...b || []].sort());
      if (!sameSet(targeting.vehicleIntent, preset.vehicleIntent)) return false;
      if (!sameSet(targeting.marketSegment, preset.marketSegment)) return false;
      if (preset.age && !sameSet(targeting.age, preset.age)) return false;
      if (preset.csp && !sameSet(targeting.csp, preset.csp)) return false;
      return true;
    }
    function computeTargetingTier(account, targeting, genericPresets) {
      const catalog = account.targetingCatalog && account.targetingCatalog.length ? account.targetingCatalog : genericPresets || [];
      if (!targeting) return "demo";
      const matched = catalog.find((p) => isPresetActive(targeting, p));
      return matched ? "premium" : "demo";
    }
    function isActivationEnabled(account, key) {
      return !!(account.activationEnabled && account.activationEnabled[key]);
    }
    function computeCampaignBudget(account, order, genericPresets) {
      const prices = accountPrices(account);
      if (order.mechanic === "leads") {
        const price = prices[order.type];
        if (!price) throw new Error(`Type de campagne invalide : ${order.type}`);
        const targetLeads = Number(order.targetLeads) || 0;
        const budget = order.mode === "budget" ? Number(order.budgetVal) || 0 : Math.round(targetLeads * price);
        return { budget, targetLeads: order.mode === "budget" ? null : targetLeads };
      }
      if (order.mechanic === "location") {
        const targetLeads = Number(order.targetLeads) || 0;
        const budget = Math.round(targetLeads * prices.location * 100) / 100;
        return { budget, targetLeads };
      }
      if (order.mechanic === "notoriete") {
        const ch = {
          sms: !!(order.notorieteChannels && order.notorieteChannels.sms),
          email: !!(order.notorieteChannels && order.notorieteChannels.email)
        };
        const activation = order.activation || {};
        const activationPlatforms = ["meta", "google", "tiktok"].filter(
          (k) => activation[k] && isActivationEnabled(account, k)
        );
        const anySelfService = ch.sms || ch.email || activationPlatforms.length > 0;
        const tier = computeTargetingTier(account, order.targeting, genericPresets);
        const smsCpm = tier === "premium" ? prices.smsPremium : prices.smsDemo;
        const emailCpm = tier === "premium" ? prices.emailPremium : prices.emailDemo;
        const volume = Number(order.targetLeads) || 0;
        let unitPrice;
        if (anySelfService) {
          unitPrice = (ch.sms ? smsCpm / 1e3 : 0) + (ch.email ? emailCpm / 1e3 : 0);
        } else {
          unitPrice = prices.notoriete / 1e3;
        }
        let budget = Math.round(volume * unitPrice);
        const wantsCrea = !!(order.email && order.email.wantsCrea && ch.email);
        if (wantsCrea) budget += prices.emailCrea;
        if (activationPlatforms.length) {
          const rate = prices.activationBase + prices.activationExtra * (activationPlatforms.length - 1);
          const raw = volume / 1e3 * rate;
          budget += Math.max(raw, prices.activationMin);
        }
        return { budget: Math.round(budget), targetLeads: volume };
      }
      throw new Error(`M\xE9canique de campagne invalide : ${order.mechanic}`);
    }
    module2.exports = { accountPrices, computeTargetingTier, computeCampaignBudget, isActivationEnabled };
  }
});

// src/genericPresets.js
var require_genericPresets = __commonJS({
  "src/genericPresets.js"(exports2, module2) {
    module2.exports = [
      { id: "suv_premium", vehicleIntent: ["suv"], marketSegment: ["haut_gamme"] },
      { id: "citadine_premium", vehicleIntent: ["citadine"], marketSegment: ["haut_gamme"] },
      { id: "berline_premium", vehicleIntent: ["berline"], marketSegment: ["haut_gamme"] },
      { id: "suv_familial", vehicleIntent: ["suv", "familiale"], marketSegment: ["milieu_gamme"] },
      { id: "citadine_entree", vehicleIntent: ["citadine"], marketSegment: ["entree_gamme"] },
      { id: "electrique_premium", vehicleIntent: ["electrique"], marketSegment: ["haut_gamme"] }
    ];
  }
});

// src/routes/campaigns.js
var require_campaigns = __commonJS({
  "src/routes/campaigns.js"(exports2, module2) {
    var express2 = require("express");
    var pool = require_pool();
    var { requireAuth } = require_auth2();
    var { computeCampaignBudget } = require_pricing();
    var GENERIC_PRESETS = require_genericPresets();
    var router = express2.Router();
    router.use(requireAuth);
    function mapRow(row) {
      return {
        id: row.id,
        name: row.name,
        mechanic: row.mechanic,
        type: row.type,
        mode: row.mode,
        targetLeads: row.target_leads !== null ? Number(row.target_leads) : null,
        budget: Number(row.budget),
        generated: row.generated,
        status: row.status,
        startDate: row.start_date,
        centerIds: row.center_ids || [],
        targeting: row.targeting,
        smsSchedule: row.sms_schedule,
        emailOrder: row.email_order,
        activationOrder: row.activation_order,
        smsResult: row.sms_result,
        emailResult: row.email_result,
        invoiceDate: row.invoice_date,
        paymentStatus: row.payment_status,
        paymentDate: row.payment_date
      };
    }
    var SELECT_WITH_CENTERS = `
  SELECT c.*, COALESCE(array_agg(cc.center_id) FILTER (WHERE cc.center_id IS NOT NULL), '{}') AS center_ids
  FROM campaigns c
  LEFT JOIN campaign_centers cc ON cc.campaign_id = c.id
`;
    router.get("/", async (req, res) => {
      try {
        const result = await pool.query(
          `${SELECT_WITH_CENTERS} WHERE c.account_id = $1 GROUP BY c.id ORDER BY c.invoice_date DESC, c.created_at DESC`,
          [req.user.accountId]
        );
        res.json(result.rows.map(mapRow));
      } catch (err) {
        console.error("Erreur GET /campaigns :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.get("/:id", async (req, res) => {
      try {
        const result = await pool.query(
          `${SELECT_WITH_CENTERS} WHERE c.id = $1 AND c.account_id = $2 GROUP BY c.id`,
          [req.params.id, req.user.accountId]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Campagne introuvable." });
        res.json(mapRow(result.rows[0]));
      } catch (err) {
        console.error("Erreur GET /campaigns/:id :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.post("/", async (req, res) => {
      const body = req.body || {};
      const { mechanic, type, mode, centerIds, startDate, targeting, smsSchedule, emailOrder, activationOrder, splitByCenter, splitLeads } = body;
      if (!mechanic || !Array.isArray(centerIds) || !centerIds.length) {
        return res.status(400).json({ error: "M\xE9canique et au moins une concession sont requis." });
      }
      const client = await pool.connect();
      try {
        const accountResult = await client.query(
          `SELECT id, pricing, activation_enabled AS "activationEnabled", targeting_catalog AS "targetingCatalog"
       FROM accounts WHERE id = $1`,
          [req.user.accountId]
        );
        const account = accountResult.rows[0];
        if (!account) return res.status(404).json({ error: "Compte introuvable." });
        const ownedCenters = await client.query(
          `SELECT id FROM centers WHERE account_id = $1 AND id = ANY($2::text[])`,
          [req.user.accountId, centerIds]
        );
        if (ownedCenters.rows.length !== centerIds.length) {
          return res.status(403).json({ error: "Une ou plusieurs concessions ne correspondent pas \xE0 votre compte." });
        }
        await client.query("BEGIN");
        const created = [];
        async function insertCampaign(orderPayload, forCenterIds) {
          const { budget, targetLeads } = computeCampaignBudget(account, orderPayload, GENERIC_PRESETS);
          const idRow = await client.query(
            `SELECT 'CAM-' || (COALESCE(MAX(NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::int), 1013) + 1) AS next_id FROM campaigns`
          );
          const id = idRow.rows[0].next_id;
          await client.query(
            `INSERT INTO campaigns (id, account_id, name, mechanic, type, mode, target_leads, budget, generated, status,
                                 start_date, targeting, sms_schedule, email_order, activation_order, invoice_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'file_attente',$9,$10,$11,$12,$13,CURRENT_DATE)`,
            [
              id,
              req.user.accountId,
              orderPayload.name || null,
              mechanic,
              type || null,
              mode || "leads",
              targetLeads,
              budget,
              startDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
              targeting ? JSON.stringify(targeting) : null,
              smsSchedule ? JSON.stringify(smsSchedule) : null,
              emailOrder ? JSON.stringify(emailOrder) : null,
              activationOrder ? JSON.stringify(activationOrder) : null
            ]
          );
          for (const centerId of forCenterIds) {
            await client.query(`INSERT INTO campaign_centers (campaign_id, center_id) VALUES ($1,$2)`, [id, centerId]);
          }
          created.push(id);
        }
        if (splitByCenter && splitLeads) {
          for (const centerId of centerIds) {
            const targetLeads = Number(splitLeads[centerId]) || 0;
            if (targetLeads <= 0) continue;
            await insertCampaign({ mechanic, type, mode: "leads", targetLeads, targeting }, [centerId]);
          }
        } else {
          await insertCampaign(
            { mechanic, type, mode, targetLeads: body.targetLeads, budgetVal: body.budgetVal, targeting, notorieteChannels: body.notorieteChannels, activation: body.activation, email: emailOrder },
            centerIds
          );
        }
        if (!created.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Aucune campagne \xE0 cr\xE9er (objectif nul)." });
        }
        await client.query("COMMIT");
        const result = await pool.query(`${SELECT_WITH_CENTERS} WHERE c.id = ANY($1::text[]) GROUP BY c.id`, [created]);
        res.status(201).json(result.rows.map(mapRow));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
        });
        console.error("Erreur POST /campaigns :", err);
        res.status(err.message && err.message.startsWith("Type de campagne") ? 400 : 500).json({ error: err.message || "Erreur serveur." });
      } finally {
        client.release();
      }
    });
    router.patch("/:id/cancel", async (req, res) => {
      try {
        const result = await pool.query(
          `UPDATE campaigns SET status = 'annulee' WHERE id = $1 AND account_id = $2 AND status != 'annulee' RETURNING id`,
          [req.params.id, req.user.accountId]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Campagne introuvable ou d\xE9j\xE0 annul\xE9e." });
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH /campaigns/:id/cancel :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    module2.exports = router;
  }
});

// src/routes/accounts.js
var require_accounts = __commonJS({
  "src/routes/accounts.js"(exports2, module2) {
    var express2 = require("express");
    var pool = require_pool();
    var { requireAuth } = require_auth2();
    var router = express2.Router();
    router.use(requireAuth);
    router.patch("/me/billing", async (req, res) => {
      const { companyName, address, cp, city, siret, vatNumber, email } = req.body || {};
      const billingInfo = { companyName, address, cp, city, siret, vatNumber, email };
      try {
        await pool.query(
          `UPDATE accounts SET billing_info = $1 WHERE id = $2`,
          [JSON.stringify(billingInfo), req.user.accountId]
        );
        res.json({ ok: true, billingInfo });
      } catch (err) {
        console.error("Erreur PATCH /accounts/me/billing :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.get("/me/broadcasts", async (req, res) => {
      try {
        const result = await pool.query(
          `SELECT * FROM broadcast_messages
       WHERE target_account_ids = '"all"'::jsonb OR target_account_ids @> $1::jsonb
       ORDER BY created_at DESC`,
          [JSON.stringify([req.user.accountId])]
        );
        res.json(result.rows.map((row) => ({
          id: row.id,
          title: row.title,
          message: row.message,
          imageDataUrl: row.image_data_url,
          overlayOpacity: row.overlay_opacity,
          titleColor: row.title_color,
          textColor: row.text_color
        })));
      } catch (err) {
        console.error("Erreur GET /accounts/me/broadcasts :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    module2.exports = router;
  }
});

// src/departements.js
var require_departements = __commonJS({
  "src/departements.js"(exports2, module2) {
    var REGION_DEPARTEMENTS = {
      "\xCEle-de-France": ["75", "77", "78", "91", "92", "93", "94", "95"],
      "Auvergne-Rh\xF4ne-Alpes": ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
      "Nouvelle-Aquitaine": ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
      "Occitanie": ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
      "Hauts-de-France": ["02", "59", "60", "62", "80"],
      "Grand Est": ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
      "Provence-Alpes-C\xF4te d\u2019Azur": ["04", "05", "06", "13", "83", "84"],
      "Pays de la Loire": ["44", "49", "53", "72", "85"],
      "Normandie": ["14", "27", "50", "61", "76"],
      "Bretagne": ["22", "29", "35", "56"],
      "Bourgogne-Franche-Comt\xE9": ["21", "25", "39", "58", "70", "71", "89", "90"],
      "Centre-Val de Loire": ["18", "28", "36", "37", "41", "45"],
      "Corse": ["2A", "2B"]
    };
    function departementsForRegions(regionNames) {
      const set = /* @__PURE__ */ new Set();
      for (const name of regionNames || []) {
        const deps = REGION_DEPARTEMENTS[name];
        if (deps) deps.forEach((d) => set.add(d));
      }
      return [...set];
    }
    module2.exports = { REGION_DEPARTEMENTS, departementsForRegions };
  }
});

// src/audienceColumns.js
var require_audienceColumns = __commonJS({
  "src/audienceColumns.js"(exports2, module2) {
    var ALLOWED_COLUMNS = [
      "cp",
      "civilite",
      "date_naissance",
      "csp_code",
      "type_logement",
      "vehicule_intention",
      "segment_marche",
      "tag_campagne",
      "departement"
    ];
    module2.exports = { ALLOWED_COLUMNS };
  }
});

// src/routes/audience.js
var require_audience = __commonJS({
  "src/routes/audience.js"(exports2, module2) {
    var express2 = require("express");
    var pool = require_pool();
    var { requireAuth } = require_auth2();
    var { departementsForRegions } = require_departements();
    var { ALLOWED_COLUMNS: ALLOWED_COLUMNS_LIST } = require_audienceColumns();
    var router = express2.Router();
    router.use(requireAuth);
    var ALLOWED_COLUMNS = new Set(ALLOWED_COLUMNS_LIST);
    function buildDemographicFilters(targeting, mappings, params) {
      const whereParts = [];
      for (const m of mappings) {
        if (!ALLOWED_COLUMNS.has(m.target_column)) continue;
        const raw = targeting[m.key];
        if (m.match_type === "age_range") {
          if (!Array.isArray(raw) || !raw.length) continue;
          const ranges = m.age_ranges || {};
          const ors = [];
          for (const rangeKey of raw) {
            const range = ranges[rangeKey];
            if (!range) continue;
            params.push(range[1] + 1);
            const maxParam = params.length;
            params.push(range[0]);
            const minParam = params.length;
            ors.push(`(${m.target_column} > CURRENT_DATE - INTERVAL '1 year' * $${maxParam} AND ${m.target_column} <= CURRENT_DATE - INTERVAL '1 year' * $${minParam})`);
          }
          if (ors.length) whereParts.push(`(${ors.join(" OR ")})`);
        } else if (m.match_type === "keyword_exact") {
          if (!raw) continue;
          params.push(raw);
          whereParts.push(`${m.target_column} = $${params.length}`);
        } else {
          if (!Array.isArray(raw) || !raw.length) continue;
          const valueMap = m.value_map;
          const vals = valueMap && Object.keys(valueMap).length ? raw.map((v) => valueMap[v]).filter(Boolean) : raw;
          if (!vals.length) continue;
          params.push(vals);
          whereParts.push(`${m.target_column} = ANY($${params.length}::text[])`);
        }
      }
      return whereParts;
    }
    router.post("/estimate", async (req, res) => {
      const { centerIds, targeting, customAddress } = req.body || {};
      const t = targeting || {};
      try {
        const whereParts = [];
        const params = [];
        if (t.geoMode === "address" && customAddress && customAddress.lat != null && customAddress.lon != null) {
          params.push(customAddress.lon, customAddress.lat, (customAddress.radiusKm || 10) * 1e3);
          whereParts.push(`ST_DWithin(location, ST_SetSRID(ST_MakePoint($${params.length - 2}, $${params.length - 1}), 4326)::geography, $${params.length})`);
        } else if (t.geoMode === "france") {
        } else if (t.geoMode === "custom") {
          const deps = departementsForRegions(t.geoRegions);
          if (!deps.length) return res.json({ audience: null, method: "no_region_selected" });
          params.push(deps);
          whereParts.push(`departement = ANY($${params.length}::text[])`);
        } else {
          if (!Array.isArray(centerIds) || !centerIds.length) {
            return res.status(400).json({ error: "Au moins une concession est requise pour ce mode de ciblage." });
          }
          const centersResult = await pool.query(
            `SELECT id, lat, lon, radius_km FROM centers WHERE account_id = $1 AND id = ANY($2::text[])`,
            [req.user.accountId, centerIds]
          );
          if (centersResult.rows.length !== centerIds.length) {
            return res.status(403).json({ error: "Une ou plusieurs concessions ne correspondent pas \xE0 votre compte." });
          }
          const withCoords = centersResult.rows.filter((c) => c.lat != null && c.lon != null);
          if (!withCoords.length) {
            return res.json({ audience: null, method: "not_geocoded" });
          }
          const centerClauses = [];
          for (const c of withCoords) {
            params.push(c.lon, c.lat, Number(c.radius_km) * 1e3);
            centerClauses.push(`ST_DWithin(location, ST_SetSRID(ST_MakePoint($${params.length - 2}, $${params.length - 1}), 4326)::geography, $${params.length})`);
          }
          whereParts.push(`(${centerClauses.join(" OR ")})`);
        }
        const mappingsResult = await pool.query(`SELECT * FROM field_mappings`);
        whereParts.push(...buildDemographicFilters(t, mappingsResult.rows, params));
        const sql = whereParts.length ? `SELECT count(*) AS n FROM audience_contacts WHERE ${whereParts.join(" AND ")}` : `SELECT count(*) AS n FROM audience_contacts`;
        const result = await pool.query(sql, params);
        res.json({ audience: Number(result.rows[0].n), method: "geospatial" });
      } catch (err) {
        console.error("Erreur POST /audience/estimate :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    module2.exports = router;
  }
});

// src/services/spotHit.js
var require_spotHit = __commonJS({
  "src/services/spotHit.js"(exports2, module2) {
    var BASE_URL = process.env.SPOTHIT_BASE_URL || "https://www.spot-hit.fr";
    function isLive() {
      return process.env.SPOTHIT_MODE === "live";
    }
    function getApiKey() {
      const key = process.env.SPOTHIT_API_KEY;
      if (!key) {
        throw new Error(
          "SPOTHIT_API_KEY n'est pas configur\xE9e. Ajoutez-la dans .env (m\xEAme en mode simulation, elle est requise pour valider la configuration avant de passer en mode live)."
        );
      }
      return key;
    }
    function toFormBody(obj) {
      const params = new URLSearchParams();
      function add(key, value) {
        if (value === void 0 || value === null) return;
        if (Array.isArray(value)) {
          value.forEach((v, i) => add(`${key}[${i}]`, v));
        } else if (typeof value === "object") {
          Object.entries(value).forEach(([k, v]) => add(`${key}[${k}]`, v));
        } else {
          params.append(key, value);
        }
      }
      Object.entries(obj).forEach(([k, v]) => add(k, v));
      return params;
    }
    async function callApi(path, params, method = "POST") {
      const key = getApiKey();
      const body = { key, ...params };
      if (!isLive()) {
        console.log(`[spotHit:simulate] ${method} ${path} ->`, JSON.stringify({ ...body, key: "***" }));
        return { simulated: true };
      }
      const url = new URL(BASE_URL + path);
      let response;
      if (method === "GET") {
        Object.entries(body).forEach(([k, v]) => {
          if (v === void 0 || v === null) return;
          url.searchParams.set(k, Array.isArray(v) || typeof v === "object" ? JSON.stringify(v) : v);
        });
        response = await fetch(url.toString(), { method: "GET" });
      } else {
        response = await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: toFormBody(body).toString()
        });
      }
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw new Error(`R\xE9ponse Spot-Hit non JSON (HTTP ${response.status}) : ${text.slice(0, 300)}`);
      }
      return json;
    }
    var ERROR_MESSAGES = {
      1: "Type de message non sp\xE9cifi\xE9 ou incorrect",
      2: "Le message est vide",
      3: "Le message contient plus de 160 caract\xE8res (70 en unicode)",
      4: "Aucun destinataire valide n'est renseign\xE9",
      5: "Num\xE9ro interdit",
      6: "Num\xE9ro de destinataire invalide",
      7: "Votre compte Spot-Hit n'a pas de formule d\xE9finie",
      8: "Exp\xE9diteur invalide",
      9: "Erreur syst\xE8me Spot-Hit \u2014 contactez leur support",
      10: "Cr\xE9dits Spot-Hit insuffisants pour effectuer cet envoi",
      11: "Envoi d\xE9sactiv\xE9 (compte de d\xE9monstration Spot-Hit)",
      12: "Compte Spot-Hit suspendu",
      13: "Limite d'envoi atteinte",
      14: "Limite d'envoi atteinte",
      15: "Limite d'envoi atteinte",
      17: "L'exp\xE9diteur n'est pas autoris\xE9",
      21: "Token invalide \u2014 contactez Spot-Hit",
      24: "Mention \xAB STOP au 36200 \xBB manquante dans le message (obligation CNIL)",
      30: "Cl\xE9 API Spot-Hit non reconnue",
      38: "Mention STOP manquante dans le message",
      62: "Limite d'envoi Spot-Hit atteinte",
      63: "Limite de requ\xEAtes API Spot-Hit d\xE9pass\xE9e",
      71: "Envois Spot-Hit temporairement indisponibles (incident en cours)",
      100: "IP non autoris\xE9e sur le compte Spot-Hit"
    };
    function describeErrors(codes) {
      const list = Array.isArray(codes) ? codes : codes != null ? [codes] : [];
      if (!list.length) return "erreur inconnue";
      return list.map((c) => `${c} (${ERROR_MESSAGES[c] || "voir la doc Spot-Hit"})`).join(", ");
    }
    var STATUT_LABELS = {
      0: "en_attente",
      1: "livre",
      // "Envoyé et bien reçu" côté /dlr, "Livré" côté doc suivi — même code
      2: "envoye_non_recu",
      3: "en_cours",
      4: "echec",
      5: "expire"
    };
    var STOP_MENTION = "STOP au 36200";
    var SMS_MAX_LENGTH = 160;
    function ensureStopMention(message, { skipStopMention } = {}) {
      if (skipStopMention) return message;
      if (/stop\s*(au\s*)?36200/i.test(message)) return message;
      const withStop = `${message.trim()} ${STOP_MENTION}`;
      if (withStop.length > SMS_MAX_LENGTH) {
        throw new Error(
          `Message trop long pour ajouter automatiquement la mention obligatoire "${STOP_MENTION}" (${withStop.length}/${SMS_MAX_LENGTH} caract\xE8res une fois ajout\xE9e). Raccourcis le message ou ajoute la mention toi-m\xEAme dans le texte, en dessous de la limite.`
        );
      }
      return withStop;
    }
    async function sendSms({ destinataires, message, expediteur, date, nom, skipStopMention }) {
      if (!message || !message.trim()) throw new Error("Message SMS vide.");
      if (!Array.isArray(destinataires) || !destinataires.length) throw new Error("Aucun destinataire fourni.");
      const finalMessage = ensureStopMention(message, { skipStopMention });
      const json = await callApi("/api/envoyer/sms", {
        destinataires,
        message: finalMessage,
        expediteur: expediteur || void 0,
        date: date || void 0,
        nom: nom ? String(nom).slice(0, 50) : void 0
      }, "POST");
      if (json.simulated) {
        return { ok: true, simulated: true, spotHitId: `sim-${Date.now()}`, recipientCount: destinataires.length, message: finalMessage };
      }
      if (!json.resultat) {
        throw new Error(`Envoi Spot-Hit refus\xE9 : ${describeErrors(json.erreurs)}`);
      }
      return { ok: true, simulated: false, spotHitId: String(json.id), recipientCount: destinataires.length, message: finalMessage };
    }
    async function getDlr({ id, produit = "sms" }) {
      if (!id) throw new Error("id de campagne Spot-Hit requis.");
      const json = await callApi("/api/dlr", { id, produit }, "GET");
      if (json.simulated) return { simulated: true, rows: [] };
      if (json && json.resultat === false) {
        throw new Error(`Suivi Spot-Hit indisponible : ${describeErrors(json.erreurs)}`);
      }
      const rows = Array.isArray(json) ? json : [];
      return {
        simulated: false,
        rows: rows.map((r) => ({
          numero: r[0],
          statut: Number(r[1]),
          statutLabel: STATUT_LABELS[Number(r[1])] || null,
          dateEmission: r[2],
          dateMiseAJour: r[3],
          statutDetaille: r[4],
          idMessage: r[5],
          operateur: r[6],
          nom: r[7]
        }))
      };
    }
    async function listStops() {
      const json = await callApi("/api/stops", {}, "GET");
      if (json.simulated) return { simulated: true, rows: [] };
      if (json && json.resultat === false) throw new Error(`Erreur Spot-Hit (stops) : ${describeErrors(json.erreurs)}`);
      const rows = Array.isArray(json) ? json : [];
      return { simulated: false, rows: rows.map((r) => ({ id: r[0], numero: r[1], dateEnvoi: r[2], sourceId: r[3] })) };
    }
    async function listResponses(params = {}) {
      const json = await callApi("/api/responses", params, "GET");
      if (json.simulated) return { simulated: true, rows: [] };
      if (json && json.resultat === false) throw new Error(`Erreur Spot-Hit (responses) : ${describeErrors(json.erreurs)}`);
      const rows = Array.isArray(json) ? json : [];
      return { simulated: false, rows: rows.map((r) => ({ id: r[0], numero: r[1], message: r[2], dateEnvoi: r[3], sourceId: r[4] })) };
    }
    async function getCredits() {
      const json = await callApi("/api/credits", {}, "GET");
      if (json.simulated) return { simulated: true };
      return { simulated: false, ...json };
    }
    module2.exports = { sendSms, getDlr, listStops, listResponses, getCredits, describeErrors, STATUT_LABELS, isLive, STOP_MENTION };
  }
});

// src/routes/admin.js
var require_admin = __commonJS({
  "src/routes/admin.js"(exports2, module2) {
    var express2 = require("express");
    var pool = require_pool();
    var { requireAuth, requireAdmin } = require_auth2();
    var { ALLOWED_COLUMNS } = require_audienceColumns();
    var spotHit = require_spotHit();
    var router = express2.Router();
    router.use(requireAuth, requireAdmin);
    function mapAccountRow(row, centers) {
      return {
        id: row.id,
        name: row.name,
        brandLabel: row.brand_label,
        portalName: row.portal_name,
        modules: row.modules,
        activationEnabled: row.activation_enabled,
        pricing: row.pricing,
        billingInfo: row.billing_info,
        targetingCatalog: row.targeting_catalog,
        ctaBanner: row.cta_banner,
        dashboardMetrics: row.dashboard_metrics,
        centers: centers.map((c) => ({ id: c.id, name: c.name, city: c.city, address: c.address, cp: c.cp, radiusKm: Number(c.radius_km) }))
      };
    }
    async function loadAccountWithCenters(client, id) {
      const accResult = await client.query(`SELECT * FROM accounts WHERE id = $1`, [id]);
      if (!accResult.rows.length) return null;
      const centersResult = await client.query(`SELECT * FROM centers WHERE account_id = $1 ORDER BY id`, [id]);
      return mapAccountRow(accResult.rows[0], centersResult.rows);
    }
    router.get("/accounts", async (req, res) => {
      try {
        const accountsResult = await pool.query(`SELECT * FROM accounts ORDER BY name`);
        const centersResult = await pool.query(`SELECT * FROM centers ORDER BY id`);
        const accounts = accountsResult.rows.map(
          (a) => mapAccountRow(a, centersResult.rows.filter((c) => c.account_id === a.id))
        );
        res.json(accounts);
      } catch (err) {
        console.error("Erreur GET /admin/accounts :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.post("/accounts", async (req, res) => {
      const { name, brandLabel, portalName } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ error: "Le nom du compte est requis." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const idRow = await client.query(
          `SELECT 'p' || (COALESCE(MAX(NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::int), 3) + 1) AS next_id FROM accounts WHERE id ~ '^p[0-9]+$'`
        );
        const id = idRow.rows[0].next_id;
        const defaultModules = { leads: true, location: true, notoriete: true, smsSelfService: false, email: false, vehicleTargeting: true, keywordTargeting: false };
        await client.query(
          `INSERT INTO accounts (id, name, brand_label, portal_name, modules, activation_enabled, targeting_catalog, pricing)
       VALUES ($1,$2,$3,$4,$5,'{}','[]','{}')`,
          [id, name.trim(), brandLabel || null, portalName || null, JSON.stringify(defaultModules)]
        );
        const centerId = id + "-c1";
        await client.query(
          `INSERT INTO centers (id, account_id, name, city, address, cp, radius_km) VALUES ($1,$2,'Concession principale','','','',10)`,
          [centerId, id]
        );
        await client.query("COMMIT");
        res.status(201).json(await loadAccountWithCenters(pool, id));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
        });
        console.error("Erreur POST /admin/accounts :", err);
        res.status(500).json({ error: "Erreur serveur." });
      } finally {
        client.release();
      }
    });
    router.post("/accounts/:id/duplicate", async (req, res) => {
      const client = await pool.connect();
      try {
        const source = await loadAccountWithCenters(client, req.params.id);
        if (!source) return res.status(404).json({ error: "Compte introuvable." });
        await client.query("BEGIN");
        const idRow = await client.query(
          `SELECT 'p' || (COALESCE(MAX(NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::int), 3) + 1) AS next_id FROM accounts WHERE id ~ '^p[0-9]+$'`
        );
        const newId = idRow.rows[0].next_id;
        await client.query(
          `INSERT INTO accounts (id, name, brand_label, portal_name, modules, activation_enabled, targeting_catalog, pricing, billing_info, cta_banner, dashboard_metrics)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            newId,
            source.name + " (copie)",
            source.brandLabel,
            source.portalName,
            JSON.stringify(source.modules),
            JSON.stringify(source.activationEnabled),
            JSON.stringify(source.targetingCatalog),
            JSON.stringify(source.pricing),
            source.billingInfo ? JSON.stringify(source.billingInfo) : null,
            source.ctaBanner ? JSON.stringify(source.ctaBanner) : null,
            source.dashboardMetrics ? JSON.stringify(source.dashboardMetrics) : null
          ]
        );
        let i = 1;
        for (const c of source.centers) {
          await client.query(
            `INSERT INTO centers (id, account_id, name, city, address, cp, radius_km) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [`${newId}-c${i++}`, newId, c.name, c.city, c.address, c.cp, c.radiusKm]
          );
        }
        await client.query("COMMIT");
        res.status(201).json(await loadAccountWithCenters(pool, newId));
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
        });
        console.error("Erreur POST /admin/accounts/:id/duplicate :", err);
        res.status(500).json({ error: "Erreur serveur." });
      } finally {
        client.release();
      }
    });
    router.delete("/accounts/:id", async (req, res) => {
      try {
        const result = await pool.query(`DELETE FROM accounts WHERE id = $1 RETURNING id`, [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: "Compte introuvable." });
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur DELETE /admin/accounts/:id :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/accounts/:id/portal-name", async (req, res) => {
      try {
        await pool.query(`UPDATE accounts SET portal_name = $1 WHERE id = $2`, [req.body.portalName || null, req.params.id]);
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH portal-name :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/accounts/:id/modules", async (req, res) => {
      const { moduleKey, value } = req.body || {};
      try {
        await pool.query(
          `UPDATE accounts SET modules = jsonb_set(COALESCE(modules,'{}'::jsonb), $1, $2::jsonb) WHERE id = $3`,
          [`{${moduleKey}}`, JSON.stringify(!!value), req.params.id]
        );
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH modules :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/accounts/:id/pricing", async (req, res) => {
      const { key, value, reset } = req.body || {};
      try {
        if (reset) {
          await pool.query(`UPDATE accounts SET pricing = '{}'::jsonb WHERE id = $1`, [req.params.id]);
          return res.json({ ok: true });
        }
        if (value === null || value === void 0) {
          await pool.query(`UPDATE accounts SET pricing = pricing - $1 WHERE id = $2`, [key, req.params.id]);
        } else {
          await pool.query(
            `UPDATE accounts SET pricing = jsonb_set(COALESCE(pricing,'{}'::jsonb), $1, $2::jsonb) WHERE id = $3`,
            [`{${key}}`, JSON.stringify(Number(value)), req.params.id]
          );
        }
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH pricing :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/accounts/:id/catalog", async (req, res) => {
      try {
        await pool.query(`UPDATE accounts SET targeting_catalog = $1 WHERE id = $2`, [JSON.stringify(req.body.targetingCatalog || []), req.params.id]);
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH catalog :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/accounts/:id/activation-enabled", async (req, res) => {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: "Cl\xE9 de destination requise." });
      try {
        await pool.query(
          `UPDATE accounts SET activation_enabled = jsonb_set(COALESCE(activation_enabled,'{}'::jsonb), $1, $2::jsonb) WHERE id = $3`,
          [`{${key}}`, JSON.stringify(!!value), req.params.id]
        );
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH activation-enabled :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/accounts/:id/cta-banner", async (req, res) => {
      try {
        const { ctaBanner } = req.body || {};
        await pool.query(`UPDATE accounts SET cta_banner = $1 WHERE id = $2`, [ctaBanner ? JSON.stringify(ctaBanner) : null, req.params.id]);
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH cta-banner :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/accounts/:id/dashboard-metrics", async (req, res) => {
      try {
        await pool.query(`UPDATE accounts SET dashboard_metrics = $1 WHERE id = $2`, [JSON.stringify(req.body.dashboardMetrics || []), req.params.id]);
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH dashboard-metrics :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    var ADMIN_CAMPAIGNS_SELECT = `
  SELECT c.*, COALESCE(array_agg(cc.center_id) FILTER (WHERE cc.center_id IS NOT NULL), '{}') AS center_ids
  FROM campaigns c
  LEFT JOIN campaign_centers cc ON cc.campaign_id = c.id
`;
    function mapCampaignRow(row) {
      return {
        id: row.id,
        accountId: row.account_id,
        name: row.name,
        mechanic: row.mechanic,
        type: row.type,
        mode: row.mode,
        targetLeads: row.target_leads !== null ? Number(row.target_leads) : null,
        budget: Number(row.budget),
        generated: row.generated,
        status: row.status,
        startDate: row.start_date,
        centerIds: row.center_ids || [],
        targeting: row.targeting,
        smsSchedule: row.sms_schedule,
        emailOrder: row.email_order,
        activationOrder: row.activation_order,
        smsResult: row.sms_result,
        emailResult: row.email_result,
        invoiceDate: row.invoice_date,
        paymentStatus: row.payment_status,
        paymentDate: row.payment_date,
        spothitCampaignId: row.spothit_campaign_id,
        spothitStatus: row.spothit_status
      };
    }
    router.get("/campaigns", async (req, res) => {
      try {
        const result = await pool.query(`${ADMIN_CAMPAIGNS_SELECT} GROUP BY c.id ORDER BY c.invoice_date DESC, c.created_at DESC`);
        res.json(result.rows.map(mapCampaignRow));
      } catch (err) {
        console.error("Erreur GET /admin/campaigns :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/campaigns/:id/processing", async (req, res) => {
      try {
        const result = await pool.query(`UPDATE campaigns SET status = 'en_cours' WHERE id = $1 RETURNING id`, [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: "Campagne introuvable." });
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH campaigns/:id/processing :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/campaigns/:id/stats", async (req, res) => {
      const { targetLeads, generated, resultField, resultValue } = req.body || {};
      try {
        const current = await pool.query(`SELECT sms_result, email_result FROM campaigns WHERE id = $1`, [req.params.id]);
        if (!current.rows.length) return res.status(404).json({ error: "Campagne introuvable." });
        const row = current.rows[0];
        const resultColumn = row.email_result ? "email_result" : row.sms_result ? "sms_result" : null;
        const sets = [];
        const values = [];
        let i = 1;
        if (targetLeads !== void 0) {
          sets.push(`target_leads = $${i++}`);
          values.push(targetLeads === null || targetLeads === "" ? null : Number(targetLeads));
        }
        if (generated !== void 0) {
          sets.push(`generated = $${i++}`);
          values.push(generated === null || generated === "" ? null : Number(generated));
        }
        if (resultField && resultColumn) {
          sets.push(`${resultColumn} = jsonb_set(COALESCE(${resultColumn},'{}'::jsonb), $${i++}, $${i++}::jsonb)`);
          values.push(`{${resultField}}`);
          values.push(JSON.stringify(resultValue === "" || resultValue === null || resultValue === void 0 ? null : Number(resultValue)));
        }
        if (!sets.length) return res.json({ ok: true });
        values.push(req.params.id);
        await pool.query(`UPDATE campaigns SET ${sets.join(", ")} WHERE id = $${i}`, values);
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH campaigns/:id/stats :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/campaigns/:id/finalize", async (req, res) => {
      try {
        const current = await pool.query(`SELECT sms_result, email_result, generated, target_leads FROM campaigns WHERE id = $1`, [req.params.id]);
        if (!current.rows.length) return res.status(404).json({ error: "Campagne introuvable." });
        const row = current.rows[0];
        const isEmail = !!row.email_result;
        const resultColumn = isEmail ? "email_result" : row.sms_result ? "sms_result" : null;
        if (!resultColumn) return res.status(400).json({ error: "Aucun r\xE9sultat SMS/Email sur cette campagne." });
        const result = isEmail ? row.email_result : row.sms_result;
        const secondaryField = isEmail ? "opens" : "clicks";
        const tertiaryField = isEmail ? "unsubscribes" : "stop";
        if (row.generated == null || result[secondaryField] == null || result[tertiaryField] == null) {
          return res.status(400).json({ error: "Renseignez toutes les valeurs avant de finaliser." });
        }
        await pool.query(
          `UPDATE campaigns SET status = 'terminee', ${resultColumn} = jsonb_set(${resultColumn}, '{consolidating}', 'false'::jsonb) WHERE id = $1`,
          [req.params.id]
        );
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur PATCH campaigns/:id/finalize :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.post("/campaigns/:id/sms/send", async (req, res) => {
      const { destinataires, message, expediteur, date } = req.body || {};
      try {
        const current = await pool.query(
          `SELECT id, sms_schedule, spothit_campaign_id FROM campaigns WHERE id = $1`,
          [req.params.id]
        );
        if (!current.rows.length) return res.status(404).json({ error: "Campagne introuvable." });
        const campaign = current.rows[0];
        if (campaign.spothit_campaign_id) {
          return res.status(409).json({ error: `Cette campagne a d\xE9j\xE0 \xE9t\xE9 envoy\xE9e via Spot-Hit (id ${campaign.spothit_campaign_id}).` });
        }
        const numeros = Array.isArray(destinataires) ? destinataires.map((n) => String(n).trim()).filter(Boolean) : String(destinataires || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
        if (!numeros.length) return res.status(400).json({ error: "Aucun destinataire fourni." });
        const schedule = campaign.sms_schedule || {};
        const finalMessage = message || schedule.message;
        if (!finalMessage) return res.status(400).json({ error: "Message SMS manquant." });
        const finalSender = expediteur || schedule.sender || void 0;
        const result = await spotHit.sendSms({ destinataires: numeros, message: finalMessage, expediteur: finalSender, date, nom: campaign.id });
        await pool.query(
          `UPDATE campaigns
       SET spothit_campaign_id = $1, spothit_status = $2, status = 'en_cours',
           sms_result = jsonb_set(COALESCE(sms_result,'{}'::jsonb), '{sent}', $3::jsonb)
       WHERE id = $4`,
          [result.spotHitId, result.simulated ? "simule" : "envoye", JSON.stringify(numeros.length), req.params.id]
        );
        res.json({ ok: true, ...result });
      } catch (err) {
        console.error("Erreur POST /admin/campaigns/:id/sms/send :", err);
        res.status(400).json({ error: err.message || "Erreur serveur." });
      }
    });
    router.get("/campaigns/:id/sms/status", async (req, res) => {
      try {
        const current = await pool.query(`SELECT spothit_campaign_id FROM campaigns WHERE id = $1`, [req.params.id]);
        if (!current.rows.length) return res.status(404).json({ error: "Campagne introuvable." });
        const spotHitId = current.rows[0].spothit_campaign_id;
        if (!spotHitId) return res.status(400).json({ error: "Cette campagne n'a pas encore \xE9t\xE9 envoy\xE9e via Spot-Hit." });
        const { rows, simulated } = await spotHit.getDlr({ id: spotHitId, produit: "sms" });
        if (!simulated) {
          const delivered = rows.filter((r) => r.statut === 1).length;
          const failed = rows.filter((r) => r.statut === 4 || r.statut === 5).length;
          await pool.query(
            `UPDATE campaigns
         SET sms_result = COALESCE(sms_result,'{}'::jsonb) || jsonb_build_object('delivered', $1::int, 'failed', $2::int)
         WHERE id = $3`,
            [delivered, failed, req.params.id]
          );
        }
        res.json({ ok: true, simulated, rows });
      } catch (err) {
        console.error("Erreur GET /admin/campaigns/:id/sms/status :", err);
        res.status(400).json({ error: err.message || "Erreur serveur." });
      }
    });
    router.get("/spothit/credits", async (req, res) => {
      try {
        res.json(await spotHit.getCredits());
      } catch (err) {
        console.error("Erreur GET /admin/spothit/credits :", err);
        res.status(400).json({ error: err.message || "Erreur serveur." });
      }
    });
    function mapFieldMappingRow(r) {
      return { key: r.key, column: r.target_column, matchType: r.match_type, valueMap: r.value_map, ageRanges: r.age_ranges, description: r.description };
    }
    function parseMappingBody(body) {
      const { column, matchType, valueMap, ageRanges, description } = body || {};
      if (!column || !ALLOWED_COLUMNS.includes(column)) {
        return { error: `Colonne invalide. Colonnes autoris\xE9es : ${ALLOWED_COLUMNS.join(", ")}.` };
      }
      if (!["exact_in", "age_range", "keyword_exact"].includes(matchType)) {
        return { error: "Type de correspondance invalide." };
      }
      let parsedValueMap = null, parsedAgeRanges = null;
      try {
        if (valueMap) parsedValueMap = typeof valueMap === "string" ? JSON.parse(valueMap) : valueMap;
        if (ageRanges) parsedAgeRanges = typeof ageRanges === "string" ? JSON.parse(ageRanges) : ageRanges;
      } catch (e) {
        return { error: "JSON invalide dans la table de correspondance ou les tranches d\u2019\xE2ge." };
      }
      return { column, matchType, valueMap: parsedValueMap, ageRanges: parsedAgeRanges, description: description || null };
    }
    router.get("/field-mappings", async (req, res) => {
      try {
        const result = await pool.query(`SELECT * FROM field_mappings ORDER BY key`);
        res.json(result.rows.map(mapFieldMappingRow));
      } catch (err) {
        console.error("Erreur GET /admin/field-mappings :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.post("/field-mappings", async (req, res) => {
      const key = (req.body || {}).key;
      if (!key || !key.trim()) return res.status(400).json({ error: "Indiquez un identifiant de crit\xE8re." });
      const parsed = parseMappingBody(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      try {
        const exists = await pool.query(`SELECT 1 FROM field_mappings WHERE key = $1`, [key.trim()]);
        if (exists.rows.length) return res.status(409).json({ error: "Ce crit\xE8re est d\xE9j\xE0 mapp\xE9 \u2014 modifiez-le plut\xF4t que d\u2019en cr\xE9er un doublon." });
        await pool.query(
          `INSERT INTO field_mappings (key, target_column, match_type, value_map, age_ranges, description) VALUES ($1,$2,$3,$4,$5,$6)`,
          [key.trim(), parsed.column, parsed.matchType, parsed.valueMap ? JSON.stringify(parsed.valueMap) : null, parsed.ageRanges ? JSON.stringify(parsed.ageRanges) : null, parsed.description]
        );
        res.status(201).json({ key: key.trim(), column: parsed.column, matchType: parsed.matchType, valueMap: parsed.valueMap, ageRanges: parsed.ageRanges, description: parsed.description });
      } catch (err) {
        console.error("Erreur POST /admin/field-mappings :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/field-mappings/:key", async (req, res) => {
      const parsed = parseMappingBody(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      try {
        const result = await pool.query(
          `UPDATE field_mappings SET target_column=$1, match_type=$2, value_map=$3, age_ranges=$4, description=$5 WHERE key=$6 RETURNING key`,
          [parsed.column, parsed.matchType, parsed.valueMap ? JSON.stringify(parsed.valueMap) : null, parsed.ageRanges ? JSON.stringify(parsed.ageRanges) : null, parsed.description, req.params.key]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Correspondance introuvable." });
        res.json({ key: req.params.key, column: parsed.column, matchType: parsed.matchType, valueMap: parsed.valueMap, ageRanges: parsed.ageRanges, description: parsed.description });
      } catch (err) {
        console.error("Erreur PATCH /admin/field-mappings/:key :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.delete("/field-mappings/:key", async (req, res) => {
      try {
        const result = await pool.query(`DELETE FROM field_mappings WHERE key = $1 RETURNING key`, [req.params.key]);
        if (!result.rows.length) return res.status(404).json({ error: "Correspondance introuvable." });
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur DELETE /admin/field-mappings/:key :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    function mapBroadcastRow(row) {
      return {
        id: row.id,
        title: row.title,
        message: row.message,
        imageDataUrl: row.image_data_url,
        overlayOpacity: row.overlay_opacity,
        titleColor: row.title_color,
        textColor: row.text_color,
        targetProIds: row.target_account_ids,
        createdAt: row.created_at
      };
    }
    router.get("/broadcasts", async (req, res) => {
      try {
        const result = await pool.query(`SELECT * FROM broadcast_messages ORDER BY created_at DESC`);
        res.json(result.rows.map(mapBroadcastRow));
      } catch (err) {
        console.error("Erreur GET /admin/broadcasts :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.post("/broadcasts", async (req, res) => {
      const { title, message, imageDataUrl, overlayOpacity, titleColor, textColor, targetProIds } = req.body || {};
      if (!message || !message.trim()) return res.status(400).json({ error: "\xC9crivez un message avant de publier." });
      const targets = targetProIds === "all" ? "all" : Array.isArray(targetProIds) ? targetProIds : null;
      if (!targets || Array.isArray(targets) && !targets.length) {
        return res.status(400).json({ error: "Choisissez au moins un compte destinataire, ou \xAB Tous les comptes \xBB." });
      }
      try {
        const id = "bc-" + Date.now().toString(36);
        await pool.query(
          `INSERT INTO broadcast_messages (id, title, message, image_data_url, overlay_opacity, title_color, text_color, target_account_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, title || null, message.trim(), imageDataUrl || null, overlayOpacity || 84, titleColor || "#ffffff", textColor || "#c7cbcf", JSON.stringify(targets)]
        );
        const result = await pool.query(`SELECT * FROM broadcast_messages WHERE id = $1`, [id]);
        res.status(201).json(mapBroadcastRow(result.rows[0]));
      } catch (err) {
        console.error("Erreur POST /admin/broadcasts :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.delete("/broadcasts/:id", async (req, res) => {
      try {
        const result = await pool.query(`DELETE FROM broadcast_messages WHERE id = $1 RETURNING id`, [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: "Message introuvable." });
        res.json({ ok: true });
      } catch (err) {
        console.error("Erreur DELETE /admin/broadcasts/:id :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    module2.exports = router;
  }
});

// src/routes/activationPlatforms.js
var require_activationPlatforms = __commonJS({
  "src/routes/activationPlatforms.js"(exports2, module2) {
    var express2 = require("express");
    var pool = require_pool();
    var { requireAuth, requireAdmin } = require_auth2();
    var router = express2.Router();
    router.use(requireAuth);
    function mapRow(r) {
      return { key: r.key, label: r.label, icon: r.icon, fieldLabel: r.field_label, desc: r.description };
    }
    router.get("/", async (req, res) => {
      try {
        const result = await pool.query(`SELECT * FROM activation_platforms ORDER BY sort_order, key`);
        res.json(result.rows.map(mapRow));
      } catch (err) {
        console.error("Erreur GET /activation-platforms :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.post("/", requireAdmin, async (req, res) => {
      const { label, icon, fieldLabel, desc } = req.body || {};
      if (!label || !label.trim()) return res.status(400).json({ error: "Indiquez un nom de destination." });
      try {
        const key = "dest-" + Date.now().toString(36);
        const orderRow = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM activation_platforms`);
        await pool.query(
          `INSERT INTO activation_platforms (key, label, icon, field_label, description, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
          [key, label.trim(), icon || "\u{1F4E1}", fieldLabel || "", desc || "", orderRow.rows[0].n]
        );
        res.status(201).json({ key, label: label.trim(), icon: icon || "\u{1F4E1}", fieldLabel: fieldLabel || "", desc: desc || "" });
      } catch (err) {
        console.error("Erreur POST /activation-platforms :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.patch("/:key", requireAdmin, async (req, res) => {
      const { label, icon, fieldLabel, desc } = req.body || {};
      if (!label || !label.trim()) return res.status(400).json({ error: "Indiquez un nom de destination." });
      try {
        const result = await pool.query(
          `UPDATE activation_platforms SET label = $1, icon = $2, field_label = $3, description = $4 WHERE key = $5 RETURNING *`,
          [label.trim(), icon || "\u{1F4E1}", fieldLabel || "", desc || "", req.params.key]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Destination introuvable." });
        res.json(mapRow(result.rows[0]));
      } catch (err) {
        console.error("Erreur PATCH /activation-platforms/:key :", err);
        res.status(500).json({ error: "Erreur serveur." });
      }
    });
    router.delete("/:key", requireAdmin, async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(`DELETE FROM activation_platforms WHERE key = $1 RETURNING key`, [req.params.key]);
        if (!result.rows.length) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Destination introuvable." });
        }
        await client.query(`UPDATE accounts SET activation_enabled = activation_enabled - $1`, [req.params.key]);
        await client.query("COMMIT");
        res.json({ ok: true });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
        });
        console.error("Erreur DELETE /activation-platforms/:key :", err);
        res.status(500).json({ error: "Erreur serveur." });
      } finally {
        client.release();
      }
    });
    module2.exports = router;
  }
});

// src/routes/webhooksSpotHit.js
var require_webhooksSpotHit = __commonJS({
  "src/routes/webhooksSpotHit.js"(exports2, module2) {
    var express2 = require("express");
    var pool = require_pool();
    var router = express2.Router();
    function checkSecret(req, res) {
      const expected = process.env.SPOTHIT_WEBHOOK_SECRET;
      if (!expected || req.query.secret !== expected) {
        res.status(403).send("forbidden");
        return false;
      }
      return true;
    }
    var STATUT_LABELS = { "0": "en_attente", "1": "livre", "2": "envoye_non_recu", "3": "en_cours", "4": "echec", "5": "expire" };
    router.get("/accuses", async (req, res) => {
      if (!checkSecret(req, res)) return;
      const { numero, statut, nom } = req.query;
      try {
        if (nom) {
          await pool.query(
            `INSERT INTO sms_events (campaign_id, event_type, numero, statut, raw)
         SELECT $1, 'accuse', $2, $3, $4::jsonb WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = $1)`,
            [nom, numero || null, STATUT_LABELS[statut] || statut || null, JSON.stringify(req.query)]
          );
          if (statut === "1" || statut === "4" || statut === "5") {
            const field = statut === "1" ? "delivered" : "failed";
            await pool.query(
              `UPDATE campaigns
           SET sms_result = jsonb_set(
             COALESCE(sms_result, '{}'::jsonb), ARRAY[$1],
             (COALESCE((sms_result->>$1)::int, 0) + 1)::text::jsonb
           )
           WHERE id = $2`,
              [field, nom]
            );
          }
        }
      } catch (err) {
        console.error("Erreur webhook Spot-Hit /accuses :", err);
      }
      res.status(200).send("ok");
    });
    router.get("/stops", async (req, res) => {
      if (!checkSecret(req, res)) return;
      const { numero, source_id } = req.query;
      try {
        await pool.query(
          `INSERT INTO sms_events (campaign_id, event_type, numero, raw)
       SELECT $1, 'stop', $2, $3::jsonb WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = $1)`,
          [source_id || null, numero || null, JSON.stringify(req.query)]
        );
        if (source_id) {
          await pool.query(
            `UPDATE campaigns
         SET sms_result = jsonb_set(COALESCE(sms_result, '{}'::jsonb), '{stop}', (COALESCE((sms_result->>'stop')::int, 0) + 1)::text::jsonb)
         WHERE id = $1`,
            [source_id]
          );
        }
      } catch (err) {
        console.error("Erreur webhook Spot-Hit /stops :", err);
      }
      res.status(200).send("ok");
    });
    router.get("/reponses", async (req, res) => {
      if (!checkSecret(req, res)) return;
      const { numero, message, source } = req.query;
      try {
        await pool.query(
          `INSERT INTO sms_events (campaign_id, event_type, numero, message, raw)
       SELECT $1, 'reponse', $2, $3, $4::jsonb WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = $1)`,
          [source || null, numero || null, message || null, JSON.stringify(req.query)]
        );
      } catch (err) {
        console.error("Erreur webhook Spot-Hit /reponses :", err);
      }
      res.status(200).send("ok");
    });
    module2.exports = router;
  }
});

// api/index.js
require("dotenv").config();
var express = require("express");
var cors = require("cors");
var authRoutes = require_auth();
var leadsRoutes = require_leads();
var campaignsRoutes = require_campaigns();
var accountsRoutes = require_accounts();
var audienceRoutes = require_audience();
var adminRoutes = require_admin();
var activationPlatformsRoutes = require_activationPlatforms();
var webhooksSpotHitRoutes = require_webhooksSpotHit();
var app = express();
app.use(cors(process.env.ALLOWED_ORIGIN ? { origin: process.env.ALLOWED_ORIGIN.split(",").map((s) => s.trim()) } : {}));
app.use(express.json({ limit: "8mb" }));
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/campaigns", campaignsRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/audience", audienceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/activation-platforms", activationPlatformsRoutes);
app.use("/api/webhooks/spothit", webhooksSpotHitRoutes);
module.exports = app;
