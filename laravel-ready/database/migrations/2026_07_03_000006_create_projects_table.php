<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('account_id')->nullable()->constrained('accounts')->cascadeOnDelete();
            $table->foreignUuid('facility_id')->nullable()->constrained('facilities')->nullOnDelete();
            $table->foreignUuid('job_site_id')->nullable()->constrained('job_sites')->nullOnDelete();
            $table->text('name');
            $table->text('project_type')->nullable();
            $table->text('status')->default('draft');
            $table->text('priority')->default('normal');
            $table->uuid('sales_rep_id')->nullable();
            $table->uuid('project_manager_id')->nullable();
            $table->decimal('estimated_value', 12, 2)->nullable();
            $table->date('start_date')->nullable();
            $table->date('end_date')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('account_id', 'idx_projects_account_id');
            $table->index('facility_id', 'idx_projects_facility_id');
            $table->index('job_site_id', 'idx_projects_job_site_id');
            $table->index('status', 'idx_projects_status');
            $table->index('project_type', 'idx_projects_type');
            $table->index('sales_rep_id', 'idx_projects_sales_rep');
            $table->index('project_manager_id', 'idx_projects_pm');
            $table->index('created_at', 'idx_projects_created_at');
            $table->index('deleted_at', 'idx_projects_deleted_at');
        });

        DB::statement("
            CREATE INDEX idx_projects_search
            ON projects
            USING GIN (
                to_tsvector(
                    'english',
                    coalesce(name, '') || ' ' || coalesce(project_type, '') || ' ' || coalesce(status, '') || ' ' || coalesce(priority, '')
                )
            )
        ");
    }

    public function down(): void
    {
        Schema::dropIfExists('projects');
    }
};
