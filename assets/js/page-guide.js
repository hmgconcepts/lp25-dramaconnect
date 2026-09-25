/**
 * ============================================================================
 * page-guide.js — DramaConnect Page Guide & Description System
 * ----------------------------------------------------------------------------
 * One authoritative description for EVERY page in the platform.
 *
 * Three consumers, one source of truth:
 *   1. Page header      — the description line under every page title
 *   2. ❓ Page help     — the floating button on every page
 *   3. Help Centre      — pages/help.html (searchable, categorised)
 *   4. Assistant bot    — assets/js/assistant.js answers "what is <page>?"
 *
 * Rules-based and offline. No AI API, no network call, no paid service.
 * ============================================================================
 */
const PAGE_GUIDE = {

  /* ---------------------------------------------------------------- Workspace */
  home: {
    icon: "fa-house", group: "Workspace", roles: "Every signed-in member",
    summary: "Your personal overview — today's rehearsals, your open tasks, unread messages and the department's latest announcements.",
    purpose: "A personal landing page that answers \"what do I need to do today?\" without opening five other pages.",
    does: "Shows your next rehearsals, the tasks assigned to you, unread inbox items, active polls that are still open, birthdays this week and the most recent announcements. Every card links straight through to the page that owns the record.",
    who: "Every member. Content is filtered to what your role allows, so a member never sees another member's private messages or admin-only controls.",
    steps: [
      "Sign in — you land here automatically.",
      "Read the \"today\" cards: rehearsals, tasks, unread messages.",
      "Click any card to jump to the page that owns it.",
      "Use the bell (top right) for the full notification feed."
    ],
    advantages: [
      "One screen replaces a morning of hunting through menus",
      "Role-aware: members, unit leaders and admins each see their own view",
      "Every card is a shortcut — no dead ends",
      "Works offline for browsing once installed as an app"
    ],
    benefit: "Nobody misses a rehearsal, a task or an announcement, so the department runs on schedule with less chasing.",
    tips: [
      "Install DramaConnect on your phone (Install banner) to open this page in one tap.",
      "The 🔔 bell keeps a running feed — clear it by opening each item."
    ],
    related: ["dashboard", "tasks", "rehearsals", "inbox"]
  },

  dashboard: {
    icon: "fa-th-large", group: "Workspace", roles: "Administrators and unit leaders",
    summary: "The Command Center — department-wide health at a glance: attendance rate, active productions, pending approvals and finance totals.",
    purpose: "A single executive view of the whole department for the people who run it.",
    does: "Aggregates live counts (members, productions, attendance rate, treasury balance, pending approvals), surfaces overdue tasks and stale backups, and offers quick actions that jump to the owning page.",
    who: "Administrators see everything. Unit leaders see their own unit. Members are better served by My Dashboard.",
    steps: [
      "Open Command Center from the sidebar.",
      "Scan the KPI tiles — anything red or amber needs attention.",
      "Use the quick actions to jump to the page that fixes it."
    ],
    advantages: [
      "Live numbers, not stale reports",
      "Colour-coded health so problems are obvious",
      "Every tile is clickable — no hunting"
    ],
    benefit: "Leaders spot problems (falling attendance, overdue tasks, missing backups) the same day instead of at the end of the season.",
    tips: ["If a tile looks wrong, open Platform Health to rule out a database or backup problem first."],
    related: ["home", "analytics", "platform-health", "reports"]
  },

  profile: {
    icon: "fa-user-circle", group: "Workspace", roles: "Every signed-in member (own profile)",
    summary: "Complete and manage your details — photo, phone, birthday, occupation, address, social links and emergency contact.",
    purpose: "The one place your personal record is kept accurate.",
    does: "Lets you upload a photo, add contact and emergency details, set your birthday (month and day only, for privacy) and watch a completion meter fill as your record gets complete.",
    who: "Every member, for their own record only.",
    steps: [
      "Open My Profile.",
      "Upload a clear head-and-shoulders photo — it appears on your ID card and in the directory.",
      "Fill phone, birthday, occupation, address and emergency contact.",
      "Watch the completion meter; aim for 100%."
    ],
    advantages: [
      "Privacy-aware: your birthday stores month and day only, never the year",
      "The completion meter tells you exactly what is still missing",
      "Your photo flows automatically to your ID card and the directory"
    ],
    benefit: "Accurate records mean the department can reach you in an emergency and celebrate you on your birthday.",
    tips: ["A complete profile is what makes your ID card and directory entry useful to everyone else."],
    related: ["idcard", "directory", "birthdays"]
  },

  idcard: {
    icon: "fa-id-card", group: "Workspace", roles: "Every signed-in member (own card); administrators and unit leaders (card register)",
    summary: "Your official, verifiable membership card — photo, a scannable Code 128 barcode and a QR code that anyone can check live.",
    purpose: "Give every member a branded identity card that cannot be forged, can be cancelled centrally and speeds up check-in at rehearsals and programmes.",
    does: "Issues your card automatically the first time you open it (member number such as DC-000123). The front carries a real Code 128 barcode of the member number for USB or camera scanners; the back carries a QR code that opens the public Verify Card page, which shows live whether the card is valid, expired, suspended or revoked. Administrators and unit leaders get the Card Register (search, reissue, revoke, restore, extend, CSV export); administrators also get Card Design (template, prefix, validity, signatory, back note, phone visibility).",
    who: "Every member views and prints their own card. Unit leaders manage cards for their unit; administrators manage every card and the design.",
    steps: [
      "Open My ID Card — your card is issued automatically.",
      "Confirm your photo and details (fix them on My Profile if needed).",
      "Click Print / Save as PDF and print front and back on card stock.",
      "Administrators: use Card Register to reissue a lost card (the old code stops working at once) or revoke a card when someone leaves.",
      "Administrators: use Card Design to choose a template, validity period and signatory."
    ],
    advantages: [
      "The barcode is a genuine Code 128 symbol tested against real decoders — it scans on USB scanners and phone cameras",
      "The QR code carries an unguessable token, not personal data, and opens a live verification page",
      "Reissue, revoke, restore and extend take effect instantly everywhere — no reprinting of lists",
      "Works without any paid card service or external QR website"
    ],
    benefit: "A professional, verifiable ID system that also makes rehearsal and programme check-in a one-second scan.",
    tips: [
      "Print on card stock and laminate — the card then lasts its whole validity period.",
      "If a card is lost, reissue it: the printed copy immediately verifies as invalid.",
      "Scanning is done from Attendance (ID Card Scanning Desk) or a programme's check-in desk."
    ],
    related: ["verify", "attendance", "profile", "directory"]
  },

  help: {
    icon: "fa-circle-question", group: "Workspace", roles: "Everyone",
    summary: "The Help Centre — searchable guides for every page, a full FAQ, troubleshooting and getting-started checklists.",
    purpose: "Self-service answers so nobody is stuck waiting for an administrator.",
    does: "Searches every page guide and FAQ entry instantly, groups guides by category, lists the getting-started checklists for members and administrators, and gives troubleshooting steps for the common failures.",
    who: "Everyone.",
    steps: [
      "Type a word in the search box (for example \"backup\", \"casting\", \"password\").",
      "Click a guide to read the full explanation.",
      "Still stuck? Use \"Message an Admin\" or the 💬 assistant."
    ],
    advantages: [
      "Covers every page — nothing is undocumented",
      "Instant search, no paging through a manual",
      "Also reachable from the ❓ button and the 💬 assistant on any page"
    ],
    benefit: "New members become productive on day one without一对一 training.",
    tips: ["Press Ctrl+K anywhere to jump to a page; press ? to open this page's guide."],
    related: ["home", "settings", "portfolio"]
  },

  portfolio: {
    icon: "fa-rocket", group: "Workspace", roles: "Everyone",
    summary: "About the architect of DramaConnect and the ecosystem behind it.",
    purpose: "Transparency about who built the platform and why it is priced the way it is.",
    does: "Presents the developer biography and the product philosophy: one-time payment, lifetime ownership, data always exportable.",
    who: "Everyone.",
    steps: [
      "Open Developer Bio to read the background and the ecosystem promise.",
      "Cross-check Site License to see the entitlement this department actually holds."
    ],
    advantages: ["No subscription lock-in", "Your data is always exportable", "Clear statement of who stands behind the platform"],
    benefit: "Confidence that the platform will not disappear behind a paywall.",
    tips: [],
    related: ["site-license", "help"]
  },

  /* ------------------------------------------------------------ Core Management */
  members: {
    icon: "fa-users", group: "Core Management", roles: "Administrators manage; everyone can view the directory",
    summary: "The personnel register — who is in the department, how to reach them, and how to add or export records.",
    purpose: "The single authoritative register of everyone in the drama department — who they are and how to reach them.",
    does: "Lists every member with role, unit, status and contact, with search and filters. Administrators create member records one at a time or in bulk from CSV, open a full profile, export the register to CSV and remove a member. Approving accounts, changing roles and assigning units are deliberately NOT here — they belong to Roles & Status, and this page shows the pending count and links you there.",
    who: "Administrators manage the register. Every member can browse the friendlier Member Directory.",
    steps: [
      "Open Members.",
      "Use search and status filters to find a person.",
      "Add a member, or open one to edit role, unit and status.",
      "Use CSV import at the start of a season, CSV export for reporting."
    ],
    advantages: [
      "One register feeds casting, attendance, tasks, finance and reports — no re-typing",
      "CSV import saves hours at the start of a season",
      "Role changes take effect immediately, enforced in the database as well as the screen"
    ],
    benefit: "One reliable source of truth for who is in the department and what they are allowed to do.",
    tips: [
      "Approvals and least-privilege role changes now live on Roles & Status — this page links there.",
      "Export a CSV before any bulk edit; it is your undo button."
    ],
    related: ["directory", "roles-status", "casting", "reports"]
  },

  directory: {
    icon: "fa-address-book", group: "Core Management", roles: "Every approved member",
    summary: "Meet the department — a browsable member directory with photos, units and contact details.",
    purpose: "A friendly, read-only view of the people in the department.",
    does: "Shows approved members with photo, unit and contact details, with search and unit filters.",
    who: "Every approved member. Pending accounts see nothing until approved on Roles & Status.",
    steps: ["Open Member Directory.", "Search by name or filter by unit.", "Click a member for their details."],
    advantages: ["Only-approved members appear", "Contact details are one tap away", "Photos come straight from My Profile"],
    benefit: "New members learn who is who in days instead of months.",
    tips: ["Complete your own profile so you show up properly here."],
    related: ["members", "profile", "myunit"]
  },

  productions: {
    icon: "fa-book-open", group: "Core Management", roles: "Administrators create; everyone can view",
    summary: "Plays, scripts and the performance timeline — every production the department mounts.",
    purpose: "The master record of what the department is performing and when.",
    does: "Create productions with title, synopsis, status, dates and venue. Each production becomes the parent for scenes, casting, rehearsals, budgets and attendance.",
    who: "Administrators create and edit. Everyone can view the schedule.",
    steps: [
      "Open Productions → add a production.",
      "Set status (planning / rehearsing / live / archived) and the performance date.",
      "Open a production to cast it, schedule rehearsals and set a budget."
    ],
    advantages: [
      "Everything hangs off the production — casting, rehearsals, budget, attendance",
      "Archiving keeps old productions out of daily screens but never deletes them"
    ],
    benefit: "One timeline the whole department can see, instead of scattered WhatsApp messages.",
    tips: ["Archive rather than delete a finished production — you keep the history for next season."],
    related: ["casting", "rehearsals", "budgets", "resources"]
  },

  casting: {
    icon: "fa-masks-theater", group: "Core Management", roles: "Administrators and directors",
    summary: "Assign characters and roles to members for each production.",
    purpose: "Decide who plays what, and keep that decision visible to everyone.",
    does: "Pick a production, then assign members to character or crew roles, with confirmation state (offered / confirmed / declined) and notes.",
    who: "Administrators and directors assign. Members see their own casting.",
    steps: [
      "Open Casting and choose the production.",
      "Add a role, then pick the member from the dropdown.",
      "Mark the assignment offered, confirmed or declined.",
      "Export the cast list for the programme."
    ],
    advantages: [
      "Members are picked from the register — no typos, no duplicate people",
      "Confirmation state ends the \"I never agreed\" arguments",
      "The cast list exports straight to Reports"
    ],
    benefit: "Casting decisions are recorded once, visibly, and cannot be quietly rewritten later.",
    tips: ["Assign understudies as separate roles so cover is explicit."],
    related: ["productions", "members", "rehearsals", "reports"]
  },

  rehearsals: {
    icon: "fa-calendar-check", group: "Core Management", roles: "Administrators schedule; everyone views",
    summary: "Sessions and goals — the rehearsal calendar with attendance targets.",
    purpose: "Plan when the department rehearses and what each session must achieve.",
    does: "Create rehearsal sessions with date, time, venue, production and a goal. Each session becomes the subject of attendance marking.",
    who: "Administrators schedule. Everyone sees the calendar.",
    steps: [
      "Open Rehearsals → add a session.",
      "Attach it to a production and set a goal for the day.",
      "On the day, mark attendance on the Attendance page."
    ],
    advantages: ["Sessions carry goals, so rehearsals have purpose", "Attendance is marked against a real session, not a free-text date"],
    benefit: "Rehearsal planning and attendance evidence finally live in the same system.",
    tips: ["Set the goal before the session — it makes the attendance report meaningful."],
    related: ["attendance", "productions", "analytics"]
  },

  attendance: {
    icon: "fa-user-check", group: "Core Management", roles: "Administrators and unit leaders mark; members see their own",
    summary: "Mark and review rehearsal attendance, including check-in codes and bulk marking.",
    purpose: "Record who actually turned up, and prove it later.",
    does: "Pick a session and mark each member present, late, absent or excused — individually, in bulk, via the check-in code an administrator announces, or by scanning member ID cards at the ID Card Scanning Desk (phone camera, webcam or USB barcode scanner). Scans are recorded by the server, repeats are ignored, and revoked, suspended or expired cards are flagged at the door. Members can also self-check-in with the code.",
    who: "Administrators and unit leaders mark attendance. Members see their own record only.",
    steps: [
      "Open Attendance and choose the rehearsal session.",
      "Mark everyone PRESENT in one click, then correct the exceptions.",
      "Or share the session check-in code so members self-check-in.",
      "Or open the ID Card Scanning Desk and scan each member's card barcode or QR code as they arrive.",
      "Review history per member on Attendance Analytics."
    ],
    advantages: [
      "Bulk marking takes seconds, not minutes",
      "The check-in code lets a room of forty people self-register",
      "Excused is distinct from absent, so the statistics stay honest",
      "Card scanning checks a member in in about a second and rejects cancelled cards"
    ],
    benefit: "Attendance evidence for casting decisions, discipline and reporting — without a paper register.",
    tips: ["Mark attendance the same day; reconstructing it a week later is unreliable."],
    related: ["rehearsals", "analytics", "members", "idcard"]
  },

  analytics: {
    icon: "fa-chart-line", group: "Core Management", roles: "Administrators and unit leaders",
    summary: "Participation rates and trends — attendance analytics over time, per member and per production.",
    purpose: "Turn raw attendance marks into decisions.",
    does: "Charts attendance rate over time, ranks members by participation, breaks attendance down by production and unit, and highlights members whose attendance is falling.",
    who: "Administrators and unit leaders.",
    steps: [
      "Open Attendance Analytics.",
      "Choose the date range and, optionally, a production or unit.",
      "Read the trend and the member ranking.",
      "Export the underlying numbers from Reports if you need them elsewhere."
    ],
    advantages: ["Trends, not just totals", "Falling attendance is flagged before it becomes a casting problem", "Every chart can be scoped to a unit"],
    benefit: "Intervene early with the members who are drifting away.",
    tips: ["Check this monthly; a slow decline is invisible day to day but obvious on a chart."],
    related: ["attendance", "reports", "dashboard"]
  },

  myunit: {
    icon: "fa-people-group", group: "Core Management", roles: "Unit leaders and administrators",
    summary: "Coordinate your unit — one screen for your unit's members, attendance and tasks.",
    purpose: "Give every unit leader their own command view without exposing the whole department.",
    does: "Shows only the leader's unit: member list, that unit's attendance, open tasks and announcements relevant to the unit.",
    who: "Unit leaders see their unit. Administrators see every unit.",
    steps: ["Open My Unit.", "Review your members and their attendance.", "Create or chase tasks from the same screen."],
    advantages: ["Scoped automatically — a leader cannot see another unit", "Attendance and tasks in one place"],
    benefit: "Unit leadership is delegated safely, so administrators are not a bottleneck.",
    tips: ["If your unit looks wrong, ask an administrator to fix the unit field on Members."],
    related: ["members", "attendance", "tasks"]
  },

  finance: {
    icon: "fa-wallet", group: "Core Management", roles: "Administrators and treasurers",
    summary: "Treasury ledger — every income and expense the department records.",
    purpose: "A single, auditable money trail.",
    does: "Records income and expenditure with date, category, amount, payer/payee and notes, and shows the running balance.",
    who: "Administrators and treasurers. Members do not see the ledger.",
    steps: [
      "Open Finance.",
      "Add an entry — income or expense — with date, category and amount.",
      "Attach a note and, where relevant, the production it belongs to.",
      "Reconcile against Budgets."
    ],
    advantages: ["Every entry is dated and categorised", "The running balance is always visible", "Exports to CSV for the church treasurer"],
    benefit: "Financial transparency without a spreadsheet that only one person understands.",
    tips: ["Record expenses the day they happen — receipts get lost, entries do not."],
    related: ["budgets", "reports", "productions"]
  },

  budgets: {
    icon: "fa-scale-balanced", group: "Core Management", roles: "Administrators and treasurers",
    summary: "Plan and track production spending against a budget.",
    purpose: "Know whether a production is on budget before the money is spent.",
    does: "Set a budget per production with line items, then compares planned against actual spend pulled from the Finance ledger.",
    who: "Administrators and treasurers.",
    steps: [
      "Open Budgets and pick the production.",
      "Add line items with planned amounts.",
      "As expenses land in Finance, watch actual vs planned.",
      "Export the budget report for leadership."
    ],
    advantages: ["Planned vs actual, live", "Per-production, so overspend is attributable", "Feeds the Reports page"],
    benefit: "No more end-of-season surprises about what a production actually cost.",
    tips: ["Set the budget before the first rehearsal, not after the first invoice."],
    related: ["finance", "productions", "reports"]
  },

  /* ------------------------------------------------------------- Communication */
  inbox: {
    icon: "fa-inbox", group: "Communication", roles: "Every signed-in member",
    summary: "Private in-platform messages between members and administrators.",
    purpose: "Keep department communication inside the platform instead of in personal WhatsApp chats.",
    does: "Send a message to a member or to \"Department Admins\", read replies, and track unread → read → archived. The sidebar shows an unread badge.",
    who: "Every signed-in member.",
    steps: [
      "Open Inbox → New Message.",
      "Pick a recipient, or choose \"Department Admins\".",
      "Send. The recipient sees a badge in their sidebar."
    ],
    advantages: ["Private by default — only sender and recipient see it", "Nothing leaves the platform", "Unread badge means nothing is missed"],
    benefit: "A record of what was asked and answered, without relying on personal chat history.",
    tips: ["Use the bell (top right) as well — system notifications land there, not in the inbox."],
    related: ["announcements", "messaging", "home"]
  },

  announcements: {
    icon: "fa-bullhorn", group: "Communication", roles: "Administrators post; everyone reads",
    summary: "Department-wide notices with priority levels and pinning.",
    purpose: "One official channel for \"this is what is happening\".",
    does: "Post a notice with a title, body, priority (normal / urgent) and optional audience. Pin the important ones so they stay at the top.",
    who: "Administrators post and pin. Everyone reads.",
    steps: [
      "Open Announcements → new announcement.",
      "Write a short title and the detail.",
      "Set priority — urgent notices are highlighted everywhere.",
      "Pin it if it must stay at the top."
    ],
    advantages: ["Urgent vs normal so people know what to read first", "Pinning stops important notices scrolling away", "Reaches everyone, including members who never check email"],
    benefit: "The end of \"nobody told me\".",
    tips: ["Keep titles to one line — most people read the title on My Dashboard and only open what matters."],
    related: ["home", "inbox", "events"]
  },

  tasks: {
    icon: "fa-list-check", group: "Communication", roles: "Administrators assign; everyone completes",
    summary: "Assign, track and complete tasks with due dates and owners.",
    purpose: "Make sure things that were agreed actually get done.",
    does: "Create a task with an owner, due date, priority and optional production link. Owners see their tasks on My Dashboard and in the notification bell.",
    who: "Administrators and unit leaders assign. Every member completes their own.",
    steps: [
      "Open Tasks → new task.",
      "Assign an owner from the member list and set a due date.",
      "The owner sees it on My Dashboard and in the bell.",
      "Mark complete when done — it drops off the open list."
    ],
    advantages: ["Every task has exactly one owner", "Due dates drive the reminders", "Overdue tasks surface automatically on the Command Center"],
    benefit: "Accountability without micromanagement.",
    tips: ["One owner per task. Shared tasks are tasks nobody does."],
    related: ["home", "dashboard", "reminders"]
  },

  messaging: {
    icon: "fa-paper-plane", group: "Communication", roles: "Administrators only",
    summary: "Send WhatsApp and email to members — free, using your own accounts.",
    purpose: "Reach people on the channels they actually read, at no cost.",
    does: "Compose a message once and send it as WhatsApp links, email or both, to a selected audience. No paid gateway — it uses WhatsApp's own click-to-chat links and your mail client.",
    who: "Administrators only.",
    steps: [
      "Open Messaging Center.",
      "Choose the audience (all members, a unit, a production cast).",
      "Write the message.",
      "Send by WhatsApp, email, or both."
    ],
    advantages: ["Zero cost — no SMS or email gateway subscription", "Audience is built from live member data", "Nothing is stored on a third-party server"],
    benefit: "Broadcast to the whole department in under a minute, for free.",
    tips: ["WhatsApp delivery uses click-to-chat links, so recipients must have your number saved for the smoothest experience."],
    related: ["announcements", "inbox", "birthdays"]
  },

  events: {
    icon: "fa-calendar-days", group: "Communication", roles: "Everyone creates and RSVPs",
    summary: "Department calendar — upcoming events with RSVP tracking.",
    purpose: "Know who is coming before you book the hall.",
    does: "Create an event with date, time, venue and description; members respond Going / Maybe / No; the organiser sees the tally.",
    who: "Everyone can create an event and RSVP to any event.",
    steps: [
      "Open Events → add event.",
      "Set date, time, venue and description.",
      "Members tap Going / Maybe / No on the card.",
      "Check the RSVP tally before you finalise arrangements."
    ],
    advantages: ["RSVP tally is live", "No external calendar service needed", "Feed of upcoming events also appears on My Dashboard"],
    benefit: "Headcount before booking, not after.",
    tips: ["Set a reminder on Scheduled Reminders so nobody forgets."],
    related: ["announcements", "reminders", "home"]
  },

  birthdays: {
    icon: "fa-cake-candles", group: "Communication", roles: "Everyone",
    summary: "Celebrate every member — birthdays this week, this month and today.",
    purpose: "Make people feel seen.",
    does: "Lists upcoming birthdays from member profiles and lets administrators send a greeting by WhatsApp or email.",
    who: "Everyone can see birthdays. Administrators can send greetings.",
    steps: [
      "Add your birth month and day on My Profile (the year is never stored).",
      "Open Birthdays to see who is coming up.",
      "Administrators: send a greeting in one click."
    ],
    advantages: ["Privacy-aware — day and month only", "Automatic, nobody maintains a list", "One-click greetings from the Messaging Center"],
    benefit: "A warmer department, with zero administrative effort.",
    tips: ["If your birthday is missing, it is because My Profile has no birth month/day — not a bug."],
    related: ["profile", "messaging", "home"]
  },

  gallery: {
    icon: "fa-images", group: "Communication", roles: "Everyone views; administrators upload",
    summary: "Photo gallery of productions, events and memories.",
    purpose: "Keep the department's visual history in one place.",
    does: "Upload photos into albums, view them in a lightbox, and manage the storage they consume via the Storage Manager.",
    who: "Everyone views. Administrators upload and delete.",
    steps: [
      "Open Photo Gallery.",
      "Open an album, or create one.",
      "Administrators: upload photos (they are resized before upload to protect your storage quota)."
    ],
    advantages: ["Photos are resized on upload, so the free storage tier lasts", "Albums keep productions organised", "Storage impact is visible on the Storage Manager"],
    benefit: "A shared memory bank instead of photos scattered across phones.",
    tips: ["Video and large photo libraries are the fastest way to fill storage — check the Storage Manager monthly."],
    related: ["storage-manager", "productions", "events"]
  },

  polls: {
    icon: "fa-square-poll-vertical", group: "Communication", roles: "Everyone votes; administrators create",
    summary: "Polls and voting — gather member opinions quickly, with live results.",
    purpose: "Make group decisions without a meeting.",
    does: "Create a poll with options and an optional closing date; members vote once; results are shown live and can be anonymous.",
    who: "Administrators create polls. Every member votes once.",
    steps: [
      "Open Polls → create a poll.",
      "Add the options and set a closing date.",
      "Members vote from My Dashboard or the Polls page.",
      "Watch the live result."
    ],
    advantages: ["One vote per member, enforced", "Anonymous option for sensitive questions", "Live results end the debate"],
    benefit: "Decisions made in hours instead of waiting for the next meeting.",
    tips: ["Use anonymous voting for anything about people, not about dates or venues."],
    related: ["suggestions", "events", "home"]
  },

  suggestions: {
    icon: "fa-lightbulb", group: "Communication", roles: "Everyone submits; administrators review",
    summary: "The suggestion box — ideas from the whole department, optionally anonymous.",
    purpose: "Hear from the people who never speak up in meetings.",
    does: "Submit an idea with an optional category; administrators review, mark status and respond.",
    who: "Everyone submits. Administrators review and respond.",
    steps: ["Open Suggestion Box → write your idea.", "Choose whether to attach your name.", "Administrators review and update the status."],
    advantages: ["Anonymous option encourages honesty", "Status tracking shows the idea was not ignored"],
    benefit: "Better decisions, and members who feel heard.",
    tips: [],
    related: ["polls", "inbox"]
  },

  resources: {
    icon: "fa-folder-open", group: "Communication", roles: "Everyone",
    summary: "Resource library — scripts, documents, audio and video for the department.",
    purpose: "One library for everything members need to rehearse.",
    does: "Post resources as links (Google Drive, YouTube, any web URL) with a title, category and description. Links are stored, never the files themselves.",
    who: "Everyone can read. Administrators add and remove.",
    steps: ["Open Resource Library.", "Browse by category, or search.", "Administrators: add a resource by pasting its link."],
    advantages: [
      "Links are stored, not files — so your storage quota is untouched",
      "Works with Google Drive, YouTube, or any shareable URL",
      "Scripts and rehearsal audio stay in one place"
    ],
    benefit: "Every member can find the script, soundtrack or notes without asking in a group chat.",
    tips: ["Add resources as links rather than uploads — it is free and keeps storage for photos."],
    related: ["productions", "gallery", "storage-manager"]
  },

  inventory: {
    icon: "fa-boxes-packing", group: "Communication", roles: "Everyone views; administrators manage",
    summary: "Inventory management — props, costumes and equipment, with condition and location.",
    purpose: "Know what the department owns and where it is.",
    does: "Track each item with category, quantity, condition, location and who holds it. Quantity and value totals are summarised at the top.",
    who: "Everyone can view. Administrators add, edit and remove.",
    steps: [
      "Open Inventory.",
      "Add an item: name, category, quantity, condition, location.",
      "Update condition when items come back from a production.",
      "Filter by category to find what you need."
    ],
    advantages: ["Condition tracking stops nasty surprises before a show", "Location field ends the \"who has the fog machine\" hunt", "Totals give you an asset value for reporting"],
    benefit: "Props and costumes stop going missing between seasons.",
    tips: ["Update condition at the end of every production, while you still remember."],
    related: ["productions", "budgets", "reports"]
  },

  reports: {
    icon: "fa-file-export", group: "Communication", roles: "Administrators and unit leaders",
    summary: "Generate and export official reports — CSV and PDF for members, attendance, casting, finance and inventory.",
    purpose: "Turn the platform's data into documents leadership can use.",
    does: "Choose a report type and a date or production scope, preview it, then export to CSV or print to PDF.",
    who: "Administrators and unit leaders.",
    steps: [
      "Open Reports.",
      "Pick the report type (members, attendance, cast list, finance, inventory).",
      "Set the scope, then generate.",
      "Export CSV for spreadsheets, or print to PDF for leadership."
    ],
    advantages: ["Every report exports to CSV and PDF", "Scope by production or date range", "Built from the same data the pages show, so it is never out of date"],
    benefit: "Reporting that takes minutes instead of an afternoon of copying.",
    tips: ["CSV is for analysis, PDF is for leadership — export both if a report is going outside the department."],
    related: ["analytics", "finance", "attendance", "members"]
  },

  /* ------------------------------------------------------------- Administration */
  reminders: {
    icon: "fa-bell", group: "Administration", roles: "Administrators only",
    summary: "Scheduled reminders — recurring automatic reminders for rehearsals, events and tasks.",
    purpose: "Let the platform do the nagging.",
    does: "Define a reminder with a subject, audience, cadence and channel; the platform raises it in the notification feed automatically.",
    who: "Administrators only.",
    steps: [
      "Open Scheduled Reminders.",
      "Choose what to remind people about and how often.",
      "Pick the audience.",
      "Save — reminders then appear in each member's bell."
    ],
    advantages: ["Recurring, so nobody has to remember to send them", "Audience-aware", "Lands in the bell and on My Dashboard"],
    benefit: "Fewer no-shows, without a single manual message.",
    tips: ["One reminder per thing. Too many reminders and people mute them all."],
    related: ["events", "tasks", "rehearsals"]
  },

  activity: {
    icon: "fa-clock-rotate-left", group: "Administration", roles: "Administrators only",
    summary: "The audit trail — every create, update, delete, import and login, recorded automatically.",
    purpose: "Be able to answer \"who did that, and when?\".",
    does: "Shows a read-only, filterable log of administrative actions with actor, action, target and timestamp. Nothing can be typed in by hand. Retention and purging are owned by the Storage Manager.",
    who: "Administrators only.",
    steps: [
      "Open Activity Log.",
      "Filter by actor, action type or date range.",
      "Investigate an incident, then export the slice you need."
    ],
    advantages: [
      "Fully automatic — nobody has to remember to write it down",
      "Read-only: an administrator cannot quietly rewrite history",
      "Exportable for a church or diocesan enquiry"
    ],
    benefit: "Real accountability, and evidence if something ever goes wrong.",
    tips: ["Retention and purging of this log is controlled on the Storage Manager — this page is deliberately read-only."],
    related: ["storage-manager", "platform-health", "roles-status"]
  },

  settings: {
    icon: "fa-gear", group: "Administration", roles: "Administrators only",
    summary: "Branding, appearance and compatibility — the department's identity, plus the launchpad into every administrative workspace.",
    purpose: "Own everything about how the platform looks, and route to everything that operates it.",
    does: "Sets the application name, logo, organisation name, province and primary theme colour; stores the device profile and appearance preferences; shows system information; and hosts the Administration control plane — live status tiles with deep links into every high-risk workspace.",
    who: "Administrators only.",
    steps: [
      "Open Settings.",
      "Branding: set name, logo, organisation, province and theme colour, then Apply Branding.",
      "Device Profile: set appearance defaults for this device.",
      "Use the control-plane tiles to jump into Admin Data, Storage Manager, Platform Health, Roles & Status or Site License."
    ],
    advantages: [
      "Every operational function lives on exactly one page — Settings routes to it, never duplicates it",
      "Control-plane tiles show live status so you know where to go before you click",
      "Branding changes apply across the whole platform immediately"
    ],
    benefit: "One obvious front door for configuration, and no confusion about which page owns which control.",
    tips: ["Looking for backups, heartbeats, storage, approvals or licensing? Use the control-plane tiles — the real controls live on their own pages."],
    related: ["admin-data", "platform-health", "storage-manager", "roles-status", "site-license"]
  },

  "admin-data": {
    icon: "fa-database", group: "Administration", roles: "Administrators only",
    summary: "The data-sovereignty centre — verified archives, Google Drive sync, private vault and recovery history.",
    purpose: "Own your data: back it up, prove it is intact, and restore it anywhere.",
    does: "Exports sealed archives of all 31 tables (SHA-256 verified), backs them up to your own Google Drive on a schedule, keeps a private Supabase vault copy, lists every backup, verifies any archive before restoring it, and runs the 🚑 disaster-recovery wizard onto a fresh database. It also shows the recent backup/restore run history and holds the re-link manifest tools.",
    who: "Administrators only.",
    steps: [
      "Local tab: export a verified archive, or verify/restore one you already have.",
      "Drive tab: paste your Google OAuth Client ID, Connect, then Backup now.",
      "Vault tab: keep a private copy inside Supabase Storage.",
      "After any restore, use the re-link manifest to rebuild member links."
    ],
    advantages: [
      "SHA-256 seal verified before upload, after upload, and before every restore — a corrupt archive can never overwrite good data",
      "Least-privilege Google Drive scope: the app can touch only the files it created",
      "Disaster-recovery mode keeps every operational row and defers only member links, which are then rebuilt by email"
    ],
    benefit: "A backup you can actually trust, restore yourself, in minutes, for free.",
    tips: [
      "Verify a backup once a quarter — an unverified backup is not a backup.",
      "Set the interval to 7 days and keep 12 archives for about three months of history."
    ],
    related: ["storage-manager", "platform-health", "help", "settings"]
  },

  "storage-manager": {
    icon: "fa-hard-drive", group: "Administration", roles: "Administrators only",
    summary: "Quota visibility, object inventory and retention — the guardian of your free-tier storage.",
    purpose: "See exactly what is using your storage, and clean it up safely.",
    does: "Shows database and file-storage usage against your quota with warning and critical thresholds, lists stored objects so you can find and remove them, and owns the retention policy — how long activity-log entries, backup runs, heartbeats and login-audit rows are kept before purging.",
    who: "Administrators only.",
    steps: [
      "Open Storage Manager and read the usage meters.",
      "Load the object inventory to find large files.",
      "Set the retention policy (activity log days, backup run days, heartbeat days, login audit days).",
      "Save the policy — purging is backup-gated, so unprotected data is never silently removed."
    ],
    advantages: [
      "Purge is backup-gated: the platform refuses to purge what has no fresh backup",
      "Retention is set in days, with safe minimums enforced",
      "Usage meters warn you long before you hit the ceiling"
    ],
    benefit: "Years of operation on the free tier, without ever losing something you needed.",
    tips: ["Check the meters monthly. Photos and videos are almost always the fastest-growing item."],
    related: ["admin-data", "platform-health", "activity", "gallery"]
  },

  "platform-health": {
    icon: "fa-heart-pulse", group: "Administration", roles: "Administrators only",
    summary: "Database, resilience, backup, licence and security evidence — the owner cockpit.",
    purpose: "One page that proves the platform is healthy, or tells you exactly what is not.",
    does: "Shows the keep-alive heartbeat (with a manual 💓 button), the quorum banner that detects a silently-dead scheduler, database and storage health, backup freshness, licence state, security controls (idle auto-lock and emergency lockdown) and the recent sign-in audit. Every external anti-pause layer is listed with its last accepted ping.",
    who: "Administrators only.",
    steps: [
      "Open Platform Health and read the quorum banner first.",
      "Press 💓 Test heartbeat to send a ping right now.",
      "Check that at least two external sources are fresh — one is a single point of failure.",
      "Review security controls and the sign-in audit."
    ],
    advantages: [
      "Quorum detection names the scheduler that has gone quiet, instead of lulling you with a green database",
      "Manual heartbeat button for holidays",
      "Everything is evidence, not assertion — you can see the last ping per source"
    ],
    benefit: "You find out that protection has failed while you can still fix it, not after the project pauses.",
    tips: [
      "If the banner says \"single point of failure\", add a second external scheduler today.",
      "Changing security controls? That is done here; changing retention? That is the Storage Manager."
    ],
    related: ["admin-data", "storage-manager", "site-license", "settings"]
  },

  "roles-status": {
    icon: "fa-user-shield", group: "Administration", roles: "Administrators only",
    summary: "Approve accounts and manage least-privilege access — the security gate for the whole department.",
    purpose: "Decide who gets in, and how much they can see once they are in.",
    does: "Lists every profile with role and status; approves or rejects pending sign-ups; changes roles; suspends accounts; and shows the four counters (all profiles, pending review, approved members, approved admins).",
    who: "Administrators only.",
    steps: [
      "Open Roles & Status.",
      "Work the Pending Review tab first — approve only people you recognise.",
      "Set each person's role to the least privilege they need.",
      "Suspend (do not delete) anyone who should lose access temporarily."
    ],
    advantages: [
      "Nobody sees anything until approved — a stranger who signs up sees an empty platform",
      "Least-privilege roles, enforced in the database as well as the UI",
      "Suspend instead of delete, so history is preserved"
    ],
    benefit: "Real access control, auditable, without any per-seat licence cost.",
    tips: ["Reject, never ignore, a stranger's sign-up — an ignored request stays ambiguous in the counters."],
    related: ["members", "activity", "platform-health"]
  },

  "site-license": {
    icon: "fa-certificate", group: "Administration", roles: "Everyone can view; administrators manage",
    summary: "Ownership, entitlement state and renewal details — proof that this site belongs to this department.",
    purpose: "A single, unambiguous statement of who owns the platform and what they are entitled to.",
    does: "Shows the licence class (lifetime ownership by default), the entitlement state, the licensed organisation, activation and renewal details, and the licence event history.",
    who: "Everyone can view the entitlement. Administrators manage activation and renewal.",
    steps: [
      "Open Site License.",
      "Confirm the licensed organisation is correct.",
      "Administrators: activate or renew, and record the change.",
      "Review the licence event history for an audit trail."
    ],
    advantages: [
      "Lifetime ownership by default — no subscription, no expiry surprise",
      "Every change is recorded in the licence event history",
      "State is visible to everyone, so there is no ambiguity about entitlement"
    ],
    benefit: "The department knows it owns its platform outright.",
    tips: ["Platform Health shows a licence summary for health purposes; this page is where licence detail lives."],
    related: ["settings", "platform-health", "portfolio"]
  },

  "reset": {
    icon: "fa-key", group: "Account", roles: "Anyone completing a password reset",
    summary: "The single-purpose screen where you choose a new password after opening a reset link.",
    purpose: "Let a member who has proven they own their email address set a password they can actually remember — without an administrator ever seeing it.",
    does: "After you click the link in a password-reset email, this screen asks for a new password twice and submits it straight to the authentication service. There is no sidebar, no navigation and no other function: it exists only to complete that one task, then it sends you back to sign in.",
    who: "Anyone who requested a password reset. It is deliberately kept outside the signed-in app so it works even when you cannot get in.",
    steps: [
      "Open the password-reset email and click the link — it opens this screen.",
      "Type your new password (at least six characters) in the first box.",
      "Type it again in the second box to confirm you typed what you meant.",
      "Press Update Password, then sign in with the new password."
    ],
    advantages: [
      "Nothing else on the screen — no distraction while you are locked out",
      "Passwords are sent only to the authentication service; no administrator can read them",
      "Works before you are signed in, so it cannot be blocked by a lockdown or an expired session"
    ],
    benefit: "A locked-out member gets back in unaided, usually within a minute.",
    tips: [
      "Reset links expire. If Update Password reports an expired or invalid link, request a fresh one from the sign-in screen.",
      "If the email never arrives, check spam and confirm the address you used is the one on your profile."
    ],
    related: ["help", "settings"]
  },

  "verify": {
    icon: "fa-shield-halved", group: "Public", roles: "Anyone (no sign-in) — security staff, ushers, partners, visitors",
    summary: "The public page that tells anyone, live, whether a DramaConnect member card is genuine and currently valid.",
    purpose: "Let anyone who is shown a member card confirm it is real — without an account and without exposing private details.",
    does: "Opens when the QR code on the back of a card is scanned. It checks the card's secret token against the department's records at that moment and shows a large coloured verdict — Valid, Expired, Suspended, Revoked or Not found — with only the photo, name, role, unit, member number and dates. You can also scan another card with the camera or type a verification link or token.",
    who: "Anyone: gate and security volunteers, ushers, host churches, or members checking their own card. It is deliberately outside the signed-in app.",
    steps: [
      "Scan the QR code on the back of the card with any phone camera — it opens this page.",
      "Read the verdict colour and message: green means valid.",
      "Compare the photo shown with the person presenting the card.",
      "To check another card, open Check another card and use the camera or paste the link."
    ],
    advantages: [
      "No login, app or account needed",
      "Shows the live status, so revoked or reissued cards fail immediately",
      "Reveals no phone number, email or token — only what is printed on the card",
      "Not indexed by search engines and sends no referrer"
    ],
    benefit: "Forged, expired or cancelled cards are caught at the door in seconds.",
    tips: [
      "A photocopied card with an old QR code shows Revoked or Not found once the card has been reissued.",
      "The barcode on the front is for check-in scanners; the QR code on the back is for this verification page."
    ],
    related: ["idcard", "attendance"]
  },

  "programs": {
    icon: "fa-ticket", group: "Communication", roles: "Administrators and unit leaders manage; every member views and shares",
    summary: "Special programmes with public online registration links you can post on social media, a check-in desk and attendance insights.",
    purpose: "Plan special programmes properly by knowing in advance who is coming, then record who actually came and learn from the numbers.",
    does: "Creates a programme (title, dates, venue, capacity, waitlist, which fields to ask, up to ten custom questions) and gives it a short public link such as register.html?p=easter-drama. The Share kit adds a tracking tag per channel (WhatsApp, Facebook, Instagram, TikTok, X, flyer QR) so you see which post brought people. Registrations get a ticket with a QR code; the Check-in desk scans tickets or member ID cards, handles walk-ins and undoes mistakes. Insights show registrations over time, sources, first-timers, age groups, turnout (show-up rate), feedback ratings and exports to CSV.",
    who: "Administrators and unit leaders create, edit, share and run check-in. Members see open programmes and can share the links. Only administrators delete programmes.",
    steps: [
      "Click New programme, fill in the title, dates, venue and capacity, then choose which fields to ask.",
      "Set the status to Open — the public link only works while the programme is open.",
      "Open Share kit and copy the link or the ready-made caption for each social network; download the flyer QR.",
      "Watch the Registrations tab; move people from the waitlist if seats free up.",
      "On the day, open Check-in desk and scan each ticket QR or member card (walk-ins can be added in seconds).",
      "Afterwards, open Insights, switch on feedback, and export the records to CSV."
    ],
    advantages: [
      "Shareable links with per-channel tracking — you know which post worked",
      "Capacity, waitlist and duplicate-registration protection are enforced by the database",
      "Registration needs no account; bots are filtered by a hidden honeypot field",
      "One page covers planning, registration, check-in and insights — no separate tools"
    ],
    benefit: "Better planning (seats, refreshments, programmes printed) and honest attendance numbers for every special event.",
    tips: [
      "Archive rather than delete finished programmes — archived records still feed Insights.",
      "Use the flyer QR on printed posters so offline visitors can register too."
    ],
    related: ["register", "calendar", "attendance", "events"]
  },

  "register": {
    icon: "fa-pen-to-square", group: "Public", roles: "Anyone (no sign-in) — guests, visitors and members",
    summary: "The public registration page opened from a shared programme link; it also shows your ticket after you register.",
    purpose: "Let anyone sign up for a special programme from a phone in under a minute and keep a ticket for check-in.",
    does: "Shows the programme details, a countdown and the seats left, then a short form with only the fields the organisers asked for. After submitting you get a ticket with a QR code and code, which you can save to your calendar, print, share on WhatsApp or use to invite a friend. Opening the ticket link later shows its live status (registered, waitlisted, checked in or cancelled) and, after the event, lets you rate the programme.",
    who: "Anyone with the link. No account, password or app is needed.",
    steps: [
      "Open the link shared by the drama team.",
      "Fill in the form and tick the consent box.",
      "Tap Register now (or Join the waitlist if the programme is full).",
      "Save or screenshot your ticket and show its QR code at the entrance."
    ],
    advantages: [
      "Works on any phone browser without signing in",
      "Registering twice with the same phone or email returns your existing ticket instead of a duplicate",
      "Tickets are remembered on your device so you can find them again",
      "Shares no personal data with third parties and is not indexed by search engines"
    ],
    benefit: "Guests register easily and the team knows exactly who to expect.",
    tips: ["Lost your ticket? Open the same programme link on the same phone — your saved tickets are listed at the bottom."],
    related: ["programs", "verify"]
  },

  "calendar": {
    icon: "fa-calendar", group: "Communication", roles: "Every signed-in member",
    summary: "One month view that combines rehearsals, events, special programmes, birthdays and your own duties.",
    purpose: "See everything the department has on in one place so nobody double-books or forgets a date.",
    does: "Draws a Monday-first month grid from the rehearsal schedule, the events list, open programmes, member birthdays and your duty-roster assignments. Each kind can be switched on or off (remembered on this device). Clicking a day lists its items with links to the page that owns them; a side list shows the next 14 days. The month can be exported as an .ics file for Google, Apple or Outlook calendars, or printed.",
    who: "Every signed-in member. Items are read from the pages that own them, so edits are made on Rehearsals, Events, Programmes, Birthdays or Duty Roster.",
    steps: [
      "Use the arrows (or Alt + ← / →) to change month; Today jumps back.",
      "Tick or untick the legend to show only what you need.",
      "Click a day to see its details and follow a link to the owning page.",
      "Click Export .ics to add the month to your phone calendar."
    ],
    advantages: [
      "Five sources in one view with no duplicate data entry",
      "Works on phones with a compact dot view",
      "Export to any calendar app without a paid service"
    ],
    benefit: "Fewer clashes and missed dates across the whole department.",
    tips: ["Programme items link straight to their public registration page, so you can share them from here."],
    related: ["rehearsals", "events", "programs", "roster", "birthdays"]
  },

  "roster": {
    icon: "fa-clipboard-user", group: "Core Management", roles: "Every member sees and answers; administrators and unit leaders assign",
    summary: "Service duty rota — who is on ushering, props, sound, costume and other duties for each service, with confirmations.",
    purpose: "Share out service duties fairly and find out early when someone cannot make it, so cover is arranged in time.",
    does: "Leaders assign one or many members to a role for a date and service, copy the last rota forward a week, reassign, remove or mark duties done or missed, and send WhatsApp reminders. Members see their upcoming duties and answer I'll be there, Can't make it or Request swap (with a short note). The full rota groups duties by date and service, highlights those that need attention and exports to CSV or print.",
    who: "Every approved member sees the rota and answers their own duties. Administrators and unit leaders create and manage assignments.",
    steps: [
      "Leaders: choose the date, service and role, pick the members and click Assign.",
      "Members: open Duty Roster and confirm each upcoming duty, or decline or request a swap with a note.",
      "Leaders: watch the 'need attention' badge and use the reassign button to give a declined duty to someone else.",
      "After the service, mark each duty done or missed."
    ],
    advantages: [
      "Members answer for themselves — no chasing on WhatsApp",
      "Past dates cannot be answered and duplicates are blocked by the database",
      "Duties also appear on each member's Calendar"
    ],
    benefit: "Every service has its duties covered, and gaps are known days in advance.",
    tips: ["Use Copy to next week for recurring rotas, then tweak only the changes."],
    related: ["calendar", "rehearsals", "tasks"]
  },

  "care": {
    icon: "fa-hand-holding-heart", group: "Core Management", roles: "Administrators and unit leaders only",
    summary: "Pastoral care and follow-up — spot members who keep missing rehearsals, reach out, and log every follow-up until resolved.",
    purpose: "Make sure no member quietly drifts away or goes through illness, bereavement or hardship without anyone checking in.",
    does: "The Missing members tab lists people who missed their most recent marked rehearsals in a row (you choose how many), with call and WhatsApp buttons and a one-click Open case. Cases record a reason (absence, welfare, illness, bereavement, celebration, new member, other), priority, who is responsible and a dated history of every note and status change (open, contacted, visited, resolved). Counters show active, high-priority and stale cases; the list exports to CSV.",
    who: "Unit leaders see and manage cases for members of their own unit or cases assigned to them; administrators see every case and are the only ones who can delete.",
    steps: [
      "Open Missing members and choose the threshold (for example 3 rehearsals).",
      "Call or WhatsApp the member, then click Open case and write a short summary.",
      "Open the case after each contact and save a follow-up note, changing the status as it progresses.",
      "Mark the case Resolved when the member is back or no longer needs support."
    ],
    advantages: [
      "Absences are only counted for rehearsals that actually had attendance marked, and only since the member joined",
      "Private: ordinary members can never see care records",
      "A full history means a new leader can pick up any case"
    ],
    benefit: "A caring department where every absence gets a friendly call and nobody falls through the cracks.",
    tips: ["Check the 'No update for 7+ days' counter weekly — it shows cases that have gone quiet."],
    related: ["attendance", "analytics", "myunit", "members"]
  }
};

/* --------------------------------------------------------------------------- */

const PageGuide = {
  registry: PAGE_GUIDE,

  /** Current page id, e.g. "admin-data". */
  currentId() {
    const raw = (location.pathname.split('/').pop() || 'home').replace(/\.html$/, '');
    return raw || 'home';
  },

  /** The guide for a page, or null. */
  get(id) {
    return PAGE_GUIDE[id] || PAGE_GUIDE[String(id).replace(/_/g, '-')] || null;
  },

  /** Every page id that has a guide. */
  ids() { return Object.keys(PAGE_GUIDE); },

  /** Guides grouped by category, in a stable order. */
  groups() {
    const order = ['Workspace', 'Core Management', 'Communication', 'Administration'];
    const out = new Map();
    this.ids().forEach(id => {
      const g = PAGE_GUIDE[id];
      if (!out.has(g.group)) out.set(g.group, []);
      out.get(g.group).push(id);
    });
    return [...out.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  },

  /** A one-line description, falling back to a generated one. */
  summary(id) {
    const g = this.get(id);
    if (g) return g.summary;
    return 'A DramaConnect workspace. Its controls and records are described on this page.';
  },

  /** Full formatted HTML for a page guide. */
  html(id) {
    const g = this.get(id);
    const esc = (window.UI && UI.esc) ? UI.esc : s => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!g) {
      return '<div class="space-y-3"><p class="font-bold">This page</p>' +
        '<p class="text-sm text-slate-600">This is the <strong>' + esc(id) + '</strong> workspace. ' +
        'It is part of the DramaConnect control plane; use the sidebar to reach the related workspaces, ' +
        'or open the Help Centre for the full guide list.</p></div>';
    }
    const li = arr => (arr || []).filter(Boolean).map(x => '<li>' + esc(x) + '</li>').join('');
    const section = (label, body) => body ? '<div><p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">'
      + label + '</p>' + body + '</div>' : '';
    return '' +
      '<div class="flex items-start gap-3 mb-4">' +
        '<span class="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center flex-none"><i class="fas ' + esc(g.icon) + '"></i></span>' +
        '<div><p class="text-lg font-extrabold text-slate-800">' + esc(id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) + '</p>' +
        '<p class="text-sm text-slate-500">' + esc(g.summary) + '</p></div>' +
      '</div>' +
      '<div class="space-y-4 text-sm">' +
        section('What it is', '<p class="text-slate-700">' + esc(g.purpose) + '</p>') +
        section('What it does', '<p class="text-slate-700">' + esc(g.does) + '</p>') +
        section('Who uses it', '<p class="text-slate-700">' + esc(g.who) + '</p>') +
        section('How to use it', '<ol class="list-decimal pl-5 space-y-1 text-slate-700">' + li(g.steps) + '</ol>') +
        section('Why it is better this way', '<ul class="list-disc pl-5 space-y-1 text-slate-700">' + li(g.advantages) + '</ul>') +
        section('Benefit to the department', '<p class="text-slate-700">' + esc(g.benefit) + '</p>') +
        section('Tips', '<ul class="list-disc pl-5 space-y-1 text-slate-600">' + li(g.tips) + '</ul>') +
      '</div>';
  },

  /** Related-page links for a guide. */
  related(id) {
    const g = this.get(id);
    return (g && g.related) ? g.related : [];
  },

  /** Open the modal for a page (defaults to the current page). */
  open(id) {
    this.close();
    const target = id || this.currentId();
    const esc = (window.UI && UI.esc) ? UI.esc : s => String(s || '').replace(/[&<>"]/g, '');
    const related = this.related(target).filter(r => r !== target).map(r =>
      '<a href="' + esc(r) + '.html" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200">' +
      esc(r.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) + '</a>').join('');
    const wrap = document.createElement('div');
    wrap.id = 'dc-page-guide-modal';
    wrap.className = 'fixed inset-0 z-[10001] flex items-center justify-center p-4';
    wrap.style.cssText = 'background:rgba(15,23,42,.55);backdrop-filter:blur(2px)';
    wrap.innerHTML =
      '<div role="dialog" aria-modal="true" aria-label="Page guide" class="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-2xl p-6 relative">' +
        '<button type="button" data-guide-close aria-label="Close" class="absolute top-3 right-3 w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100 text-xl leading-none">&times;</button>' +
        this.html(target) +
        (related ? '<div class="mt-5 pt-4 border-t border-slate-100"><p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Related pages</p><div class="flex flex-wrap gap-2">' + related + '</div></div>' : '') +
        '<div class="mt-5 pt-4 border-t border-slate-100 flex flex-wrap gap-2 items-center justify-between">' +
          '<p class="text-xs text-slate-500">Need more? Ask the 💬 assistant or open the Help Centre.</p>' +
          '<a href="help.html" class="text-xs font-bold text-blue-600 hover:underline">Open Help Centre →</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };
    wrap.querySelector('[data-guide-close]').addEventListener('click', () => this.close());
    wrap.addEventListener('click', ev => { if (ev.target === wrap) this.close(); });
    wrap.addEventListener('touchmove', stop, { passive: false });
    document.addEventListener('keydown', this._escHandler);
    return wrap;
  },

  close() {
    const m = document.getElementById('dc-page-guide-modal');
    if (m) m.remove();
    document.removeEventListener('keydown', this._escHandler);
  },

  _escHandler(ev) { if (ev.key === 'Escape') PageGuide.close(); },

  /** Mount the floating help button. */
  mountButton() {
    if (document.getElementById('dc-page-help-btn') || document.getElementById('dc-page-guide-modal')) return;
    const btn = document.createElement('button');
    btn.id = 'dc-page-help-btn';
    btn.type = 'button';
    btn.title = 'Explain this page (press ?)';
    btn.setAttribute('aria-label', 'Explain this page');
    btn.innerHTML = '<i class="fas fa-circle-question"></i><span>Page guide</span>';
    btn.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:9989;display:inline-flex;align-items:center;gap:8px;' +
      'padding:11px 16px;border:none;border-radius:999px;cursor:pointer;font-size:13px;font-weight:700;' +
      'color:#fff;background:linear-gradient(135deg,#2563eb,#7c3aed);box-shadow:0 10px 24px rgba(37,99,235,.35)';
    btn.addEventListener('click', () => this.open());
    document.body.appendChild(btn);
  },

  /** Write the description into the page header (under the title). */
  describeHeader() {
    const id = this.currentId();
    const g = this.get(id);
    const sub = document.querySelector('#page-header p.text-slate-500, #page-header .text-slate-500');
    if (!sub || !g) return;
    if (sub.getAttribute('data-guide-described') === '1') return;
    sub.setAttribute('data-guide-described', '1');
    sub.textContent = g.summary;
  },

  init() {
    if (this._done) return;
    this._done = true;
    try { this.describeHeader(); } catch (e) { /* never block the page */ }
    try { this.mountButton(); } catch (e) { /* never block the page */ }
    document.addEventListener('keydown', ev => {
      const t = ev.target || {};
      const tag = String(t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
      if (ev.key === '?') { ev.preventDefault(); this.open(); }
    });
  }
};

window.PageGuide = PageGuide;
window.PAGE_GUIDE = PAGE_GUIDE;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => PageGuide.init());
} else {
  PageGuide.init();
}
