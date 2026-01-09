"""
Seed Domain Knowledge Templates for RAG

PROMPT #84 - RAG Phase 2: Interview Enhancement

This script seeds domain-specific knowledge templates into the RAG system.
These templates help the AI ask more relevant contextual questions during interviews.

Usage:
    python -m backend.scripts.seed_domain_templates

Templates for:
- E-commerce
- SaaS
- CMS/Blog
- Marketplace
- Financial/Banking
- Social Network
- Healthcare
- Education/LMS
- Real Estate
- Logistics/Delivery
"""

import sys
import os
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from app.database import SessionLocal
from app.services.rag_service import RAGService
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Domain knowledge templates
DOMAIN_TEMPLATES = {
    "e-commerce": [
        {
            "content": "E-commerce: Payment gateway integration (Stripe, PayPal, Mercado Pago). Questions: Which payment methods? International payments? Installments? Refund handling?",
            "category": "payments"
        },
        {
            "content": "E-commerce: Product catalog management. Questions: Product variants (size, color)? Bulk import/export? Categories and filters? Stock control? Product recommendations?",
            "category": "catalog"
        },
        {
            "content": "E-commerce: Shopping cart and checkout. Questions: Guest checkout? Saved carts? Coupon/discount system? Shipping calculation? Order tracking?",
            "category": "checkout"
        },
        {
            "content": "E-commerce: Inventory management. Questions: Multi-warehouse? Low stock alerts? Automatic reorder? Inventory reports? Barcode/SKU system?",
            "category": "inventory"
        },
        {
            "content": "E-commerce: Customer reviews and ratings. Questions: Review moderation? Verified purchase only? Photos in reviews? Rating breakdown? Helpful votes?",
            "category": "reviews"
        },
    ],

    "saas": [
        {
            "content": "SaaS: Subscription and billing. Questions: Billing cycles (monthly/annual)? Free trial? Proration on plan changes? Invoice generation? Usage-based billing?",
            "category": "billing"
        },
        {
            "content": "SaaS: Multi-tenancy architecture. Questions: Data isolation level? Tenant customization? White-label support? Per-tenant limits? Tenant analytics?",
            "category": "architecture"
        },
        {
            "content": "SaaS: User roles and permissions. Questions: Team member roles? Custom permissions? Role hierarchy? Audit logs? SSO/SAML support?",
            "category": "access_control"
        },
        {
            "content": "SaaS: Onboarding and activation. Questions: Welcome email sequence? Product tour? Sample data? Setup wizard? Activation metrics?",
            "category": "onboarding"
        },
        {
            "content": "SaaS: API and integrations. Questions: REST/GraphQL API? Webhooks? OAuth? API rate limiting? Integration marketplace?",
            "category": "integrations"
        },
    ],

    "cms_blog": [
        {
            "content": "CMS/Blog: Content types and custom fields. Questions: Post types (blog, pages, products)? Custom fields? Rich text editor? Media library? SEO metadata?",
            "category": "content"
        },
        {
            "content": "CMS/Blog: Publishing workflow. Questions: Draft/review/publish states? Scheduled publishing? Content versioning? Multi-author support? Editorial calendar?",
            "category": "workflow"
        },
        {
            "content": "CMS/Blog: SEO and analytics. Questions: SEO optimization tools? Meta tags? Sitemap generation? Analytics integration? Search functionality?",
            "category": "seo"
        },
        {
            "content": "CMS/Blog: Media management. Questions: Image optimization? CDN integration? Video hosting? File uploads? Image galleries?",
            "category": "media"
        },
    ],

    "marketplace": [
        {
            "content": "Marketplace: Seller onboarding. Questions: Seller verification? Approval workflow? Seller profiles? Store customization? Seller dashboard?",
            "category": "sellers"
        },
        {
            "content": "Marketplace: Commission structure. Questions: Commission percentage? Fee calculation? Payout schedule? Seller statements? Transaction history?",
            "category": "commissions"
        },
        {
            "content": "Marketplace: Dispute resolution. Questions: Buyer/seller messaging? Dispute escalation? Refund policies? Mediation system? Review appeals?",
            "category": "disputes"
        },
        {
            "content": "Marketplace: Trust and safety. Questions: Identity verification? Escrow payments? Fraud detection? User ratings? Banned users/products?",
            "category": "trust_safety"
        },
    ],

    "financial_banking": [
        {
            "content": "Financial/Banking: Account management. Questions: Account types? Multi-currency? Account statements? Transaction history? Account freezing?",
            "category": "accounts"
        },
        {
            "content": "Financial/Banking: Transactions and transfers. Questions: Internal transfers? External transfers? ACH/wire? Transfer limits? Transaction approvals?",
            "category": "transactions"
        },
        {
            "content": "Financial/Banking: Security and compliance. Questions: 2FA/MFA? KYC/AML? PCI DSS compliance? Audit trails? Encryption standards?",
            "category": "security"
        },
        {
            "content": "Financial/Banking: Reporting and analytics. Questions: Financial reports? Dashboards? Export capabilities? Regulatory reporting? Real-time notifications?",
            "category": "reporting"
        },
    ],

    "social_network": [
        {
            "content": "Social Network: User profiles and connections. Questions: Profile customization? Friend/follower model? Connection requests? Privacy settings? Blocking users?",
            "category": "profiles"
        },
        {
            "content": "Social Network: Content feed and discovery. Questions: Algorithmic feed? Chronological feed? Hashtags? Trending topics? Content filtering?",
            "category": "feed"
        },
        {
            "content": "Social Network: Messaging and chat. Questions: Direct messages? Group chats? Voice/video calls? Message encryption? Read receipts?",
            "category": "messaging"
        },
        {
            "content": "Social Network: Content moderation. Questions: User reporting? Automated moderation? Content filters? Moderator tools? Appeals process?",
            "category": "moderation"
        },
    ],

    "healthcare": [
        {
            "content": "Healthcare: Patient records and EHR. Questions: Medical history? Lab results? Medications? Allergies? Document uploads? HIPAA compliance?",
            "category": "records"
        },
        {
            "content": "Healthcare: Appointments and scheduling. Questions: Appointment booking? Calendar sync? Reminders? Cancellations? Waitlist management?",
            "category": "scheduling"
        },
        {
            "content": "Healthcare: Telemedicine. Questions: Video consultations? E-prescriptions? Chat with providers? Session recording? Insurance verification?",
            "category": "telemedicine"
        },
        {
            "content": "Healthcare: Billing and insurance. Questions: Insurance claims? Co-pay calculation? Payment plans? Invoice generation? Insurance verification?",
            "category": "billing"
        },
    ],

    "education_lms": [
        {
            "content": "Education/LMS: Course structure. Questions: Course modules? Lesson types (video, text, quiz)? Prerequisites? Learning paths? Certificates?",
            "category": "courses"
        },
        {
            "content": "Education/LMS: Student assessment. Questions: Quiz types? Grading system? Assignments? Peer review? Progress tracking?",
            "category": "assessment"
        },
        {
            "content": "Education/LMS: Engagement and collaboration. Questions: Discussion forums? Live classes? Study groups? Messaging? Notifications?",
            "category": "engagement"
        },
        {
            "content": "Education/LMS: Content delivery. Questions: Video hosting? Live streaming? Document viewers? Mobile offline access? Content DRM?",
            "category": "content_delivery"
        },
    ],

    "real_estate": [
        {
            "content": "Real Estate: Property listings. Questions: Property types? Photos/videos? Virtual tours? Floor plans? Location maps? Price history?",
            "category": "listings"
        },
        {
            "content": "Real Estate: Search and filters. Questions: Location search? Price range? Property features? Saved searches? Alerts? Map view?",
            "category": "search"
        },
        {
            "content": "Real Estate: Lead management. Questions: Contact forms? Appointment scheduling? CRM integration? Lead tracking? Follow-up automation?",
            "category": "leads"
        },
        {
            "content": "Real Estate: Agent/broker tools. Questions: Agent profiles? Agency management? Commission tracking? Document signing? Transaction management?",
            "category": "agents"
        },
    ],

    "logistics_delivery": [
        {
            "content": "Logistics/Delivery: Order tracking. Questions: Real-time GPS tracking? Status updates? Delivery notifications? Proof of delivery? Route optimization?",
            "category": "tracking"
        },
        {
            "content": "Logistics/Delivery: Fleet management. Questions: Vehicle tracking? Driver assignment? Fuel management? Maintenance schedules? Driver performance?",
            "category": "fleet"
        },
        {
            "content": "Logistics/Delivery: Warehouse operations. Questions: Inventory management? Picking/packing? Barcode scanning? Zone management? Stock alerts?",
            "category": "warehouse"
        },
        {
            "content": "Logistics/Delivery: Customer service. Questions: Delivery preferences? Rescheduling? Missed delivery? Customer feedback? Support tickets?",
            "category": "customer_service"
        },
    ],
}


def seed_domain_templates():
    """Seed all domain knowledge templates into RAG."""
    db = SessionLocal()

    try:
        rag_service = RAGService(db)

        total_seeded = 0

        for domain, templates in DOMAIN_TEMPLATES.items():
            logger.info(f"Seeding domain: {domain} ({len(templates)} templates)")

            for template in templates:
                # Store template in RAG (global knowledge, project_id=None)
                rag_service.store(
                    content=template["content"],
                    metadata={
                        "type": "domain_template",
                        "domain": domain,
                        "category": template["category"],
                        "source": "seed_script"
                    },
                    project_id=None  # Global knowledge
                )

                total_seeded += 1

        logger.info(f"✅ Successfully seeded {total_seeded} domain templates")
        logger.info(f"Domains covered: {', '.join(DOMAIN_TEMPLATES.keys())}")

        # Get RAG stats
        stats = rag_service.get_stats()
        logger.info(f"📊 Total RAG documents: {stats['total_documents']}")
        logger.info(f"📊 Global documents: {stats['global_documents']}")

    except Exception as e:
        logger.error(f"❌ Failed to seed domain templates: {e}", exc_info=True)
        raise

    finally:
        db.close()


if __name__ == "__main__":
    logger.info("Starting domain knowledge templates seeding...")
    seed_domain_templates()
    logger.info("Seeding completed!")
