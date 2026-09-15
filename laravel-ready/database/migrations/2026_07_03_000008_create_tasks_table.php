<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tasks', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('work_order_id')->nullable()->constrained('work_orders')->cascadeOnDelete();
            $table->text('title')->nullable();
            $table->text('description')->nullable();
            $table->text('status')->default('open');
            $table->uuid('assigned_to')->nullable();
            $table->timestamp('due_date')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('work_order_id', 'idx_tasks_work_order_id');
            $table->index('status', 'idx_tasks_status');
            $table->index('assigned_to', 'idx_tasks_assigned_to');
            $table->index('due_date', 'idx_tasks_due_date');
            $table->index('deleted_at', 'idx_tasks_deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tasks');
    }
};
