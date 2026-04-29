-- Supabase Schema for GiftShop Admin System
-- Users table for authentication and user management

-- Ensure needed extensions (UUID, crypto)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'delivery_worker')),
    is_verified BOOLEAN DEFAULT FALSE,
    profile_picture_url TEXT,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_password_reminder_sent TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email verification codes table
CREATE TABLE IF NOT EXISTS email_verification_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Password reset codes table
CREATE TABLE IF NOT EXISTS password_reset_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_user_id ON email_verification_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user_id ON password_reset_codes(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample admin user (password: admin123)
INSERT INTO users (username, email, password, role, is_verified, password_changed_at) 
VALUES (
    'admin', 
    'admin@giftshop.com', 
    '$2b$10$Eot7dsRNc/UAJmfCARCr5.goIFIDhnxBBYOhXhOK2AX//W4LgaL8S', 
    'admin', 
    true,
    NOW()
) ON CONFLICT (email) DO NOTHING;

-- Update existing users to set password_changed_at if NULL (for existing data)
UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL;

-- =============================
-- Gifts inventory
-- =============================

CREATE TABLE IF NOT EXISTS gifts (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    image TEXT NULL, -- emoji or URL
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to auto-update updated_at on gifts
DROP TRIGGER IF EXISTS update_gifts_updated_at ON gifts;
CREATE TRIGGER update_gifts_updated_at
    BEFORE UPDATE ON gifts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_gifts_category ON gifts(category);
CREATE INDEX IF NOT EXISTS idx_gifts_created_at ON gifts(created_at DESC);
-- full-text-like search support on name (simple)
CREATE INDEX IF NOT EXISTS idx_gifts_name_tsv ON gifts USING GIN (to_tsvector('simple', name));

-- =============================
-- Feedback (user reviews)
-- =============================
CREATE TABLE IF NOT EXISTS feedback (
    id BIGSERIAL PRIMARY KEY,
    user_name VARCHAR(50),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);

-- =============================
-- Wishlist
-- =============================
CREATE TABLE IF NOT EXISTS wishlist (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gift_id BIGINT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, gift_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_gift_id ON wishlist(gift_id);

-- =============================
-- Shopping Cart
-- =============================
CREATE TABLE IF NOT EXISTS cart (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gift_id BIGINT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, gift_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_user_id ON cart(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_gift_id ON cart(gift_id);

CREATE TRIGGER update_cart_updated_at
    BEFORE UPDATE ON cart
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================
-- Orders
-- =============================
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
    shipping_address TEXT,
    payment_method VARCHAR(50),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    total NUMERIC(10,2) NOT NULL DEFAULT 0,
    needs_delivery BOOLEAN DEFAULT FALSE,
    delivery_address TEXT,
    delivery_phone VARCHAR(20),
    house_name VARCHAR(255),
    floor VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================
-- Order Items
-- =============================
CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    gift_id BIGINT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    price NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_gift_id ON order_items(gift_id);




CREATE INDEX IF NOT EXISTS idx_donations_user_id ON donations(user_id);
CREATE INDEX IF NOT EXISTS idx_donations_cause_id ON donations(cause_id);

-- =============================
-- Community Ideas
-- =============================
CREATE TABLE IF NOT EXISTS community_ideas (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    likes_count INTEGER NOT NULL DEFAULT 0,
    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_ideas_user_id ON community_ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_community_ideas_created_at ON community_ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_ideas_is_flagged ON community_ideas(is_flagged);
CREATE INDEX IF NOT EXISTS idx_community_ideas_is_flagged ON community_ideas(is_flagged);

CREATE TRIGGER update_community_ideas_updated_at
    BEFORE UPDATE ON community_ideas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================
-- Community Idea Likes
-- =============================
CREATE TABLE IF NOT EXISTS community_idea_likes (
    id BIGSERIAL PRIMARY KEY,
    idea_id BIGINT NOT NULL REFERENCES community_ideas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(idea_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_idea_likes_idea_id ON community_idea_likes(idea_id);
CREATE INDEX IF NOT EXISTS idx_community_idea_likes_user_id ON community_idea_likes(user_id);

-- =============================
-- Community Comments
-- =============================
CREATE TABLE IF NOT EXISTS community_comments (
    id BIGSERIAL PRIMARY KEY,
    idea_id BIGINT NOT NULL REFERENCES community_ideas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_comments_idea_id ON community_comments(idea_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_user_id ON community_comments(user_id);

-- =============================
-- Chat Logs (for chat history)
-- =============================
CREATE TABLE IF NOT EXISTS chat_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_message TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_user_id ON chat_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at ON chat_logs(created_at DESC);




-- =============================
-- Reminders (if not already exists from previous schema)
-- =============================
CREATE TABLE IF NOT EXISTS reminders (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    person TEXT NOT NULL,
    remind_date DATE NOT NULL,
    pref VARCHAR(20) CHECK (pref IN ('app', 'email')),
    description TEXT,
    reminder_type VARCHAR(20) DEFAULT 'ai' CHECK (reminder_type IN ('ai', 'event')),
    is_recurring BOOLEAN DEFAULT FALSE,
    original_date DATE,
    recurrence_type VARCHAR(20) CHECK (recurrence_type IN ('yearly', 'monthly', 'weekly')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_date ON reminders(remind_date);
CREATE INDEX IF NOT EXISTS idx_reminders_type ON reminders(reminder_type);
CREATE INDEX IF NOT EXISTS idx_reminders_recurring ON reminders(is_recurring);

CREATE TRIGGER update_reminders_updated_at
    BEFORE UPDATE ON reminders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================
-- Supabase Storage: gift images bucket
-- Bucket name: gift-images
-- Configure via Supabase Dashboard > Storage > Create Bucket > gift-images
-- Make public for now or use signed URLs if privacy required

-- =============================
-- Supabase Storage: profile pictures bucket
-- Bucket name: prof-picture
-- Configure via Supabase Dashboard > Storage > Create Bucket > prof-picture
-- Make public for now or use signed URLs if privacy required


--ACTIVITY LOGS TABLE
create table if not exists activity_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade,
  type text not null,
  message text not null,
  created_at timestamp with time zone default now()
);

-- =============================
-- Notifications
-- =============================
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'reminder' CHECK (type IN ('reminder', 'system', 'order', 'other')),
    reminder_id BIGINT REFERENCES reminders(id) ON DELETE SET NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_reminder_id ON notifications(reminder_id);

-- =============================
-- Delivery Assignments
-- =============================
CREATE TABLE IF NOT EXISTS delivery_assignments (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    delivery_worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivery_status VARCHAR(20) NOT NULL DEFAULT 'assigned' CHECK (delivery_status IN ('assigned', 'in_transit', 'delivered', 'failed')),
    driver_feedback TEXT,
    client_feedback TEXT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(order_id) -- One assignment per order
);

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_order_id ON delivery_assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_worker_id ON delivery_assignments(delivery_worker_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_status ON delivery_assignments(delivery_status);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_assigned_at ON delivery_assignments(assigned_at DESC);

CREATE TRIGGER update_delivery_assignments_updated_at
    BEFORE UPDATE ON delivery_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update notifications type to include 'delivery'
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
    CHECK (type IN ('reminder', 'system', 'order', 'delivery', 'other'));