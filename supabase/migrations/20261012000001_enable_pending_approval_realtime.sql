-- Keep pending-approval badges synchronized without requiring a page refresh.
-- The frontend already subscribes to these tables; they must also be part of
-- Supabase's realtime publication for INSERT and UPDATE events to be delivered.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'transfer_requests'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.transfer_requests;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'stock_adjustments'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_adjustments;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'portioning_requests'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.portioning_requests;
        END IF;
    END IF;
END $$;
