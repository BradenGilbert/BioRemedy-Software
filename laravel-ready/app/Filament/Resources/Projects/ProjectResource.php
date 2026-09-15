<?php

namespace App\Filament\Resources\Projects;

use App\Filament\Resources\Projects\Pages\ManageProjects;
use App\Models\Project;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class ProjectResource extends Resource
{
    protected static ?string $model = Project::class;

    protected static ?string $recordTitleAttribute = 'name';

    public static function form(Form $form): Form
    {
        return $form->schema([
            Select::make('account_id')->relationship('account', 'name')->searchable()->preload(),
            Select::make('facility_id')->relationship('facility', 'name')->searchable()->preload(),
            Select::make('job_site_id')->relationship('jobSite', 'name')->searchable()->preload(),
            TextInput::make('name')->required()->maxLength(255),
            TextInput::make('project_type')->maxLength(255),
            TextInput::make('status')->default('draft')->maxLength(255),
            TextInput::make('priority')->default('normal')->maxLength(255),
            Select::make('sales_rep_id')->relationship('salesRep', 'name')->searchable()->preload(),
            Select::make('project_manager_id')->relationship('projectManager', 'name')->searchable()->preload(),
            TextInput::make('estimated_value')->numeric()->prefix('$'),
            DatePicker::make('start_date'),
            DatePicker::make('end_date'),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')->searchable()->sortable(),
                TextColumn::make('account.name')->label('Account')->searchable()->sortable(),
                TextColumn::make('jobSite.name')->label('Job site')->searchable(),
                TextColumn::make('project_type')->searchable()->sortable(),
                TextColumn::make('status')->badge()->sortable(),
                TextColumn::make('priority')->badge()->sortable(),
                TextColumn::make('estimated_value')->money('USD')->sortable(),
                TextColumn::make('start_date')->date()->sortable(),
            ])
            ->filters([
                SelectFilter::make('status'),
                SelectFilter::make('project_type'),
                SelectFilter::make('priority'),
            ])
            ->actions([
                EditAction::make(),
            ])
            ->bulkActions([
                BulkActionGroup::make([
                    DeleteBulkAction::make(),
                ]),
            ]);
    }

    public static function getPages(): array
    {
        return [
            'index' => ManageProjects::route('/'),
        ];
    }
}
