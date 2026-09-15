<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('facility_nodes', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('facility_id')->nullable()->constrained('facilities')->cascadeOnDelete();
            $table->foreignUuid('parent_id')->nullable()->references('id')->on('facility_nodes')->nullOnDelete();
            $table->text('name');
            $table->text('node_type')->nullable();
            $table->text('description')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('facility_id', 'idx_facility_nodes_facility_id');
            $table->index('parent_id', 'idx_facility_nodes_parent_id');
            $table->index('deleted_at', 'idx_facility_nodes_deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('facility_nodes');
    }
};
