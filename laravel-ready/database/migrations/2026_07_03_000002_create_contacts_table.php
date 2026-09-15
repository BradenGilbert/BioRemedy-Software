<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contacts', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('account_id')->nullable()->constrained('accounts')->cascadeOnDelete();
            $table->text('first_name')->nullable();
            $table->text('last_name')->nullable();
            $table->text('title')->nullable();
            $table->text('email')->nullable();
            $table->text('phone')->nullable();
            $table->boolean('is_primary')->default(false);
            $table->timestamps();
            $table->softDeletes();

            $table->index('account_id', 'idx_contacts_account_id');
            $table->index('email', 'idx_contacts_email');
            $table->index(['last_name', 'first_name'], 'idx_contacts_name');
            $table->index('deleted_at', 'idx_contacts_deleted_at');
        });

        DB::statement("
            CREATE INDEX idx_contacts_search
            ON contacts
            USING GIN (
                to_tsvector(
                    'english',
                    coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(title, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '')
                )
            )
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('contacts');
    }
};
