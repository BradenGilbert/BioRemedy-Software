<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('facilities', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('account_id')->nullable()->constrained('accounts')->cascadeOnDelete();
            $table->text('name');
            $table->text('facility_type');
            $table->text('address')->nullable();
            $table->text('city')->nullable();
            $table->text('state')->nullable();
            $table->text('postal_code')->nullable();
            $table->double('latitude')->nullable();
            $table->double('longitude')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('account_id', 'idx_facilities_account_id');
            $table->index('facility_type', 'idx_facilities_type');
            $table->index(['latitude', 'longitude'], 'idx_facilities_location');
            $table->index('deleted_at', 'idx_facilities_deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('facilities');
    }
};
