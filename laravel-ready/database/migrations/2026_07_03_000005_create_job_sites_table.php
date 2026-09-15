<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('job_sites', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('account_id')->nullable()->constrained('accounts')->cascadeOnDelete();
            $table->foreignUuid('facility_id')->nullable()->constrained('facilities')->nullOnDelete();
            $table->foreignUuid('facility_node_id')->nullable()->constrained('facility_nodes')->nullOnDelete();
            $table->text('name')->nullable();
            $table->text('site_type');
            $table->text('description')->nullable();
            $table->double('latitude')->nullable();
            $table->double('longitude')->nullable();
            $table->text('linear_reference')->nullable();
            $table->boolean('is_temporary')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index('account_id', 'idx_job_sites_account_id');
            $table->index('facility_id', 'idx_job_sites_facility_id');
            $table->index('facility_node_id', 'idx_job_sites_node_id');
            $table->index('site_type', 'idx_job_sites_type');
            $table->index(['latitude', 'longitude'], 'idx_job_sites_geo');
            $table->index('deleted_at', 'idx_job_sites_deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('job_sites');
    }
};
