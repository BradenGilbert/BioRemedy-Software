<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_orders', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('project_id')->nullable()->constrained('projects')->cascadeOnDelete();
            $table->text('name')->nullable();
            $table->text('status')->default('pending');
            $table->integer('sequence')->nullable();
            $table->timestamp('start_date')->nullable();
            $table->timestamp('end_date')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('project_id', 'idx_work_orders_project_id');
            $table->index('status', 'idx_work_orders_status');
            $table->index('sequence', 'idx_work_orders_sequence');
            $table->index('deleted_at', 'idx_work_orders_deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('work_orders');
    }
};
