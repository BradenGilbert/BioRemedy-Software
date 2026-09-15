<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('crews', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->text('name')->nullable();
            $table->text('description')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('name', 'idx_crews_name');
            $table->index('deleted_at', 'idx_crews_deleted_at');
        });

        Schema::create('crew_members', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->foreignUuid('crew_id')->nullable()->constrained('crews')->cascadeOnDelete();
            $table->uuid('user_id')->nullable();
            $table->text('role')->nullable();
            $table->timestamp('created_at')->nullable()->useCurrent();
            $table->softDeletes();

            $table->index('crew_id', 'idx_crew_members_crew_id');
            $table->index('user_id', 'idx_crew_members_user_id');
            $table->index('deleted_at', 'idx_crew_members_deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('crew_members');
        Schema::dropIfExists('crews');
    }
};
