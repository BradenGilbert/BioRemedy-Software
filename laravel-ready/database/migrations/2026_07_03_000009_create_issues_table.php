<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('issues', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('project_id')->nullable()->constrained('projects')->nullOnDelete();
            $table->foreignUuid('task_id')->nullable()->constrained('tasks')->nullOnDelete();
            $table->text('issue_type')->nullable();
            $table->text('severity')->nullable();
            $table->text('title')->nullable();
            $table->text('description')->nullable();
            $table->text('status')->default('open');
            $table->uuid('created_by')->nullable();
            $table->uuid('assigned_to')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('project_id', 'idx_issues_project_id');
            $table->index('task_id', 'idx_issues_task_id');
            $table->index('status', 'idx_issues_status');
            $table->index('severity', 'idx_issues_severity');
            $table->index('assigned_to', 'idx_issues_assigned_to');
            $table->index('created_at', 'idx_issues_created_at');
            $table->index('deleted_at', 'idx_issues_deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('issues');
    }
};
