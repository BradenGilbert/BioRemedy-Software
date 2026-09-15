<?php

namespace App\Filament\Resources\Issues;

use App\Filament\Resources\Issues\Pages\ManageIssues;
use App\Models\Issue;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Form;
use Filament\Resources\Resource;
use Filament\Tables\Actions\BulkActionGroup;
use Filament\Tables\Actions\DeleteBulkAction;
use Filament\Tables\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class IssueResource extends Resource
{
    protected static ?string $model = Issue::class;

    protected static ?string $recordTitleAttribute = 'title';

    public static function form(Form $form): Form
    {
        return $form->schema([
            Select::make('project_id')->relationship('project', 'name')->searchable()->preload(),
            Select::make('task_id')->relationship('task', 'title')->searchable()->preload(),
            TextInput::make('issue_type')->maxLength(255),
            TextInput::make('severity')->maxLength(255),
            TextInput::make('title')->maxLength(255),
            Textarea::make('description')->columnSpanFull(),
            TextInput::make('status')->default('open')->maxLength(255),
            Select::make('created_by')->relationship('creator', 'name')->searchable()->preload(),
            Select::make('assigned_to')->relationship('assignedUser', 'name')->searchable()->preload(),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('project.name')->label('Project')->searchable()->sortable(),
                TextColumn::make('title')->searchable()->sortable(),
                TextColumn::make('issue_type')->searchable()->sortable(),
                TextColumn::make('severity')->badge()->sortable(),
                TextColumn::make('status')->badge()->sortable(),
                TextColumn::make('assignedUser.name')->label('Assigned to')->searchable(),
                TextColumn::make('created_at')->dateTime()->sortable(),
            ])
            ->filters([
                SelectFilter::make('status'),
                SelectFilter::make('severity'),
                SelectFilter::make('issue_type'),
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
            'index' => ManageIssues::route('/'),
        ];
    }
}
