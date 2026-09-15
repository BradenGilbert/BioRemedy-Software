<?php

namespace App\Filament\Resources\JobSites\Pages;

use App\Filament\Resources\JobSites\JobSiteResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ManageRecords;

class ManageJobSites extends ManageRecords
{
    protected static string $resource = JobSiteResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
