<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('files', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('project_id')->nullable()->constrained('projects')->nullOnDelete();
            $table->foreignUuid('task_id')->nullable()->constrained('tasks')->nullOnDelete();
            $table->foreignUuid('issue_id')->nullable()->constrained('issues')->nullOnDelete();
            $table->text('file_type')->nullable();
            $table->text('url')->nullable();
            $table->jsonb('metadata')->nullable();
            $table->timestamp('created_at')->nullable()->useCurrent();
            $table->softDeletes();

            $table->index('project_id', 'idx_files_project_id');
            $table->index('task_id', 'idx_files_task_id');
            $table->index('issue_id', 'idx_files_issue_id');
            $table->index('file_type', 'idx_files_type');
            $table->index('created_at', 'idx_files_created_at');
            $table->index('deleted_at', 'idx_files_deleted_at');
        });

        DB::statement('CREATE INDEX idx_files_activity_time ON files(created_at DESC)');
    }

    public function down(): void
    {
        Schema::dropIfExists('files');
    }
};
