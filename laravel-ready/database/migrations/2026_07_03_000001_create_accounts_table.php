<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

        Schema::create('accounts', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->text('name');
            $table->text('type')->nullable();
            $table->text('status')->default('active');
            $table->text('billing_address')->nullable();
            $table->text('phone')->nullable();
            $table->text('email')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('name', 'idx_accounts_name');
            $table->index('type', 'idx_accounts_type');
            $table->index('status', 'idx_accounts_status');
            $table->index('deleted_at', 'idx_accounts_deleted_at');
        });

        DB::statement("
            CREATE INDEX idx_accounts_search
            ON accounts
            USING GIN (
                to_tsvector(
                    'english',
                    coalesce(name, '') || ' ' || coalesce(type, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '')
                )
            )
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('accounts');
    }
};
