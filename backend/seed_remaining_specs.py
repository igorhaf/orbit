"""
Seed PostgreSQL and Tailwind CSS Specs (PROMPT #47 - Phase 2)
Combined seeder for remaining frameworks
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.spec import Spec
from uuid import uuid4

# PostgreSQL Specs
POSTGRESQL_SPECS = [
    {
        "category": "database",
        "name": "postgresql",
        "spec_type": "table",
        "title": "Table Creation",
        "description": "PostgreSQL table with constraints and indexes",
        "content": """CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;""",
        "language": "sql",
        "file_extensions": ["sql"],
        "ignore_patterns": []
    },
    {
        "category": "database",
        "name": "postgresql",
        "spec_type": "query",
        "title": "SELECT Query",
        "description": "Optimized SELECT query with joins",
        "content": """SELECT
  u.id,
  u.name,
  u.email,
  COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.is_active = true
  AND u.created_at >= NOW() - INTERVAL '30 days'
GROUP BY u.id, u.name, u.email
HAVING COUNT(o.id) > 0
ORDER BY order_count DESC
LIMIT 100;""",
        "language": "sql",
        "file_extensions": ["sql"],
        "ignore_patterns": []
    },
    {
        "category": "database",
        "name": "postgresql",
        "spec_type": "function",
        "title": "Function/Procedure",
        "description": "PostgreSQL function with logic",
        "content": """CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();""",
        "language": "sql",
        "file_extensions": ["sql"],
        "ignore_patterns": []
    },
    {
        "category": "database",
        "name": "postgresql",
        "spec_type": "view",
        "title": "Materialized View",
        "description": "Materialized view for performance",
        "content": """CREATE MATERIALIZED VIEW user_statistics AS
SELECT
  u.id,
  u.name,
  COUNT(DISTINCT o.id) as total_orders,
  SUM(o.amount) as total_spent,
  MAX(o.created_at) as last_order_date
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name;

CREATE UNIQUE INDEX idx_user_statistics_id ON user_statistics(id);

-- Refresh view
REFRESH MATERIALIZED VIEW CONCURRENTLY user_statistics;""",
        "language": "sql",
        "file_extensions": ["sql"],
        "ignore_patterns": []
    },
]

# Tailwind CSS Specs
TAILWIND_SPECS = [
    {
        "category": "css",
        "name": "tailwind",
        "spec_type": "component",
        "title": "Component Styling",
        "description": "Tailwind CSS component with utility classes",
        "content": """<div className="flex items-center justify-between p-4 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200">
  <div className="flex items-center space-x-3">
    <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
      <svg className="w-6 h-6 text-primary-600" /* SVG content */ />
    </div>
    <div>
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  </div>
  <button className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors">
    Action
  </button>
</div>""",
        "language": "jsx",
        "file_extensions": ["jsx", "tsx"],
        "ignore_patterns": ["node_modules/*"]
    },
    {
        "category": "css",
        "name": "tailwind",
        "spec_type": "config",
        "title": "Tailwind Configuration",
        "description": "tailwind.config.js with custom theme",
        "content": """/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      spacing: {
        '128': '32rem',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}""",
        "language": "javascript",
        "file_extensions": ["js", "mjs"],
        "ignore_patterns": ["node_modules/*"]
    },
    {
        "category": "css",
        "name": "tailwind",
        "spec_type": "layout",
        "title": "Layout Pattern",
        "description": "Common layout patterns with Tailwind",
        "content": """{/* Grid Layout */}
<div className="container mx-auto px-4">
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {items.map(item => (
      <div key={item.id} className="bg-white rounded-lg p-6 shadow">
        {/* Card content */}
      </div>
    ))}
  </div>
</div>

{/* Flexbox Layout */}
<div className="flex flex-col min-h-screen">
  <header className="sticky top-0 z-50 bg-white border-b">
    {/* Header */}
  </header>
  <main className="flex-1 container mx-auto px-4 py-8">
    {/* Main content */}
  </main>
  <footer className="bg-gray-50 border-t mt-auto">
    {/* Footer */}
  </footer>
</div>""",
        "language": "jsx",
        "file_extensions": ["jsx", "tsx"],
        "ignore_patterns": ["node_modules/*"]
    },
    {
        "category": "css",
        "name": "tailwind",
        "spec_type": "responsive",
        "title": "Responsive Design",
        "description": "Responsive utilities and breakpoints",
        "content": """<div className="
  w-full
  px-4 sm:px-6 lg:px-8
  py-6 sm:py-8 lg:py-12
  text-sm sm:text-base lg:text-lg
  grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4
">
  <div className="
    col-span-1 sm:col-span-2 lg:col-span-1
    hidden sm:block
    order-first lg:order-last
  ">
    {/* Responsive column */}
  </div>
</div>

{/* Container queries */}
<div className="@container">
  <div className="@lg:flex @lg:space-x-4">
    {/* Container query responsive */}
  </div>
</div>""",
        "language": "jsx",
        "file_extensions": ["jsx", "tsx"],
        "ignore_patterns": ["node_modules/*"]
    },
]

ALL_SPECS = POSTGRESQL_SPECS + TAILWIND_SPECS


def seed_specs():
    """Seed remaining specs into database"""
    db = SessionLocal()

    try:
        print(f"🌱 Seeding {len(ALL_SPECS)} specs (PostgreSQL + Tailwind)...")

        created_count = 0
        updated_count = 0

        for spec_data in ALL_SPECS:
            existing = db.query(Spec).filter(
                Spec.category == spec_data["category"],
                Spec.name == spec_data["name"],
                Spec.spec_type == spec_data["spec_type"]
            ).first()

            if existing:
                for key, value in spec_data.items():
                    setattr(existing, key, value)
                updated_count += 1
                print(f"   ↻ Updated: {spec_data['name']} - {spec_data['spec_type']}")
            else:
                spec = Spec(id=uuid4(), **spec_data)
                db.add(spec)
                created_count += 1
                print(f"   ✓ Created: {spec_data['name']} - {spec_data['spec_type']}")

        db.commit()
        print(f"\n✅ All specs seeded successfully!")
        print(f"   📦 Created: {created_count}")
        print(f"   🔄 Updated: {updated_count}")
        print(f"   📊 Total: {len(ALL_SPECS)} specs")

    except Exception as e:
        db.rollback()
        print(f"❌ Error seeding specs: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_specs()
