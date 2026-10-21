# NYUMBAKE 🏡

**Find a home. Deal directly. Live better.**

![Status](https://img.shields.io/badge/status-in%20development-orange)
![Stack](https://img.shields.io/badge/stack-HTML%20%7C%20CSS%20%7C%20JS%20%7C%20Supabase-blue)

NYUMBAKE is a digital rental marketplace that connects tenants directly with property owners, reducing the need for brokers and unnecessary rental costs. Landlords list their properties; tenants search, compare, and contact landlords in one place.

**Initial launch:** Nairobi, Kenya · **Future expansion:** across Kenya

🌐 **Live site:** [nyumbake-kenya.vercel.app](https://nyumbake-kenya.vercel.app)

> 🚧 NYUMBAKE is under active development. See [Progress](#progress) for what is working so far.

---

## The problem

House hunting in Nairobi usually goes through brokers who charge viewing and finder's fees, and listings are scattered across WhatsApp groups and social media. NYUMBAKE gives tenants a single place to find rentals and talk to landlords directly.

## Objectives

- Connect tenants directly with landlords
- Reduce dependency on brokers and avoid unnecessary brokerage fees
- Make it easier for tenants to search and compare rental properties
- Give landlords a platform to advertise and manage their properties
- Promote transparency and trust in the rental process
- Build a scalable platform that can expand to other property categories and locations

## Features

**Accounts**
- Tenant and landlord registration, login, and logout
- Password reset
- Role-based access to platform features
- User profile management

**For tenants**
- Browse available rentals with photos, descriptions, rent, location, and amenities
- Search and filter by location, rent, and property type
- Contact landlords directly through the platform
- Personal tenant dashboard

**For landlords**
- Upload and manage rental properties with images and details
- Set and update each property's availability status
- View published properties
- Review enquiries from prospective tenants

**For admins**
- Admin dashboard for platform management
- Review and moderate property listings
- Account and property verification

**Planned**
- M-Pesa payments via the Safaricom Daraja API, processed securely on the server
- Payment records and transaction status tracking
- Commercial listings such as shops and godowns
- Expansion beyond Nairobi

## Tech stack

| Technology | Purpose |
| --- | --- |
| HTML, CSS, JavaScript | Frontend pages, styling, and interactivity |
| Supabase | Authentication and file storage |
| PostgreSQL (via Supabase) | Relational database |
| Git & GitHub | Version control and collaboration |
| Vercel | Hosting and deployment |
| Safaricom Daraja API | Planned M-Pesa integration |

## Progress

<!-- Tick each box once the feature works end to end on the live site. -->

**Phase 1: Foundation**
- [x] Define the project concept and objectives
- [x] Establish the project structure
- [x] Set up the GitHub repository
- [x] Create the website layout
- [x] Deploy to Vercel

**Phase 2: Database and authentication**
- [ ] Design the PostgreSQL database schema
- [ ] Configure Supabase
- [ ] Tenant and landlord registration
- [ ] Login, logout, and password reset
- [ ] Row Level Security policies

**Phase 3: Property management**
- [ ] Property upload form
- [ ] Supabase Storage for property images
- [ ] Landlord property management dashboard
- [ ] Property details page

**Phase 4: Tenant experience**
- [ ] Property browsing page
- [ ] Search and filtering
- [ ] Tenant dashboard
- [ ] Direct tenant–landlord enquiries
- [ ] Improved mobile and desktop experience

**Phase 5: Administration and trust**
- [ ] Admin dashboard
- [ ] Listing moderation
- [ ] Property and landlord verification
- [ ] Reporting and audit logs

**Phase 6: Payments and expansion**
- [ ] Secure M-Pesa integration
- [ ] Payment tracking where required
- [ ] Commercial property categories (shops, godowns)
- [ ] Expansion beyond Nairobi

## Project structure

```text
NYUMBAKE/
├── index.html
├── landlord-signup.html
├── tenant-signup.html
├── reset-password.html
├── property-upload.html
├── tenant-browse.html
├── tenant-dashboard.html
├── property-details.html
├── landlord-dashboard.html
├── admin-dashboard.html
├── 404.html
│
├── assets/
│   ├── css/
│   │   └── styles.css
│   ├── images/
│   ├── icons/
│   └── fonts/
│
├── js/
│   ├── supabase-client.js
│   ├── auth.js
│   ├── validation.js
│   ├── property-form.js
│   ├── landlord-dashboard.js
│   ├── tenant-browse.js
│   ├── property-details.js
│   └── notifications.js
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   └── seed.sql
│
├── docs/
│   ├── architecture.md
│   ├── database-design.md
│   ├── security.md
│   └── roadmap.md
│
├── .env.example
├── .gitignore
└── README.md
```

*The project structure may evolve as development progresses.*

## Running locally

**Prerequisites:** [Visual Studio Code](https://code.visualstudio.com/), [Git](https://git-scm.com/), a modern web browser, and a [Supabase](https://supabase.com/) account.

1. Clone the repository and open it in VS Code:

   ```bash
   git clone https://github.com/Bennah123/NYUMBAKE.git
   cd NYUMBAKE
   code .
   ```

2. Copy `.env.example` and fill in your Supabase project URL and public anon key.
3. Open `index.html` in a browser, or use a local server such as the VS Code Live Server extension.

## Security

- Supabase Row Level Security (RLS) controls access to data
- User input is validated on both the client and server
- Service-role keys, M-Pesa credentials, and other secrets stay out of frontend code and public repositories
- Administrative operations are restricted to authorized users
- Access controls apply to property listings, user profiles, and uploaded files
- Verification and audit logging will be introduced as the platform develops

## Vision

NYUMBAKE aims to make renting more direct, transparent, and convenient by bringing tenants and landlords together through technology, growing from a Nairobi-focused marketplace into a platform serving rental needs across Kenya.

## Contributors

- [@Bennah123](https://github.com/Bennah123): project owner
- [@Kinoti-254](https://github.com/Kinoti-254): Dev
<!-- Add yourself: - [@your-username](https://github.com/your-username): what you built -->

Suggestions, feedback, and contributions that improve usability, accessibility, security, and reliability are welcome.

## License

[MIT](LICENSE)

---

**NYUMBAKE — Find a home. Deal directly. Live better.** 🏡