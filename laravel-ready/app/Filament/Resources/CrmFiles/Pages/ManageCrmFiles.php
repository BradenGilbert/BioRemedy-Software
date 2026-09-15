<?php

namespace App\Filament\Resources\CrmFiles\Pages;

use App\Filament\Resources\CrmFiles\CrmFileResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ManageRecords;

class ManageCrmFiles extends ManageRecords
{
    protected static string $resource = CrmFileResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make(),
        ];
    }
}
