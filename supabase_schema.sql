-- ============================================================
-- POKEMON ESPECTRAL LEAGUE — Supabase Schema
-- Pega esto en el SQL Editor de Supabase (Database > SQL Editor)
-- ============================================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS public.users (
    id       SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    avatar_url TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. SAVE_DATA
CREATE TABLE IF NOT EXISTS public.save_data (
    id                    SERIAL PRIMARY KEY,
    user_id               INTEGER REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    party                 JSONB DEFAULT '[]',
    boxes                 JSONB DEFAULT '[]',
    nuzlocke              JSONB DEFAULT '{"deaths":[],"enabled":true}',
    trainer               JSONB DEFAULT '{}',
    nuzlocke_points       INTEGER DEFAULT 0,
    nuzlocke_points_earned INTEGER DEFAULT 0,
    nuzlocke_points_spent  INTEGER DEFAULT 0,
    nuzlocke_points_deaths INTEGER DEFAULT 0,
    updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. TOURNAMENT
CREATE TABLE IF NOT EXISTS public.tournament (
    id         SERIAL PRIMARY KEY,
    state      JSONB DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fila inicial del torneo (solo si no existe)
INSERT INTO public.tournament (state)
SELECT '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.tournament LIMIT 1);

-- ============================================================
-- RLS (Row Level Security) - Desactivado para compatibilidad
-- con el backend Node.js que usa service_role key
-- ============================================================
ALTER TABLE public.users     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.save_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament DISABLE ROW LEVEL SECURITY;
